/**
 * 认证状态管理
 * 从原项目 src/modules/login.js 和 src/core/connection.js 迁移
 */

import {clearAuthFileModelsCache} from '@/features/authFiles/authFileModelsCache'
import {apiClient} from '@/services/api/client'
import {type ServerFeatureFlags, versionApi} from '@/services/api/version'
import {secureStorage} from '@/services/storage/secureStorage'
import type {ApiError, AuthState, ConnectionStatus, LoginCredentials} from '@/types'
import {detectApiBaseFromLocation, normalizeApiBase, resolveApiBase} from '@/utils/connection'
import {STORAGE_KEY_AUTH} from '@/utils/constants'
import {create} from 'zustand'
import {createJSONStorage, persist, type StateStorage} from 'zustand/middleware'
import {useAuthFilesSummaryStore} from './useAuthFilesSummaryStore'
import {useConfigStore} from './useConfigStore'
import {useModelsStore} from './useModelsStore'
import {useQuotaStore} from './useQuotaStore'
import {useUsageStatsStore} from './useUsageStatsStore'

type SessionRestoreStatus = 'idle' | 'restoring' | 'succeeded' | 'failed' | 'skipped'

type RestorableAuthCredentials = {
    apiBase: string
    managementKey: string
    persistent: boolean
    source: 'bundle' | 'legacy'
    storageTransactionId: string | null
}

type StoredAuthCredentials = {
    version: 1
    apiBase: string
    managementKey: string
    transactionId: string
}

type AuthStorageTransaction = {
    id: string
    persistent: boolean
    lockAvailable: boolean
    superseded: boolean
}

type AuthStorageLockResult<T> =
    | { status: 'acquired'; value: T }
    | { status: 'unsupported' | 'failed'; value: null }

type AuthStorageCommitResult =
    | { status: 'stored' | 'superseded'; clearFailed: false }
    | { status: 'memory-only'; clearFailed: boolean }

type AuthStorageRestoreResult =
    | { status: 'credentials'; credentials: AuthCredentialsReadResult }
    | { status: 'invalidated'; storageCleared: boolean }

type AuthCredentialsReadResult =
    | { status: 'value'; value: RestorableAuthCredentials }
    | { status: 'absent' | 'unreadable' | 'invalid' | 'cancelled'; value: null }

interface AuthStoreState extends AuthState {
    connectionStatus: ConnectionStatus
    connectionError: string | null
    hydrated: boolean
    serverVersionSource: 'header' | 'version' | null
    storageRestoreFailed: boolean
    storagePersistenceFailed: boolean
    storageClearFailed: boolean
    sessionRestoreStatus: SessionRestoreStatus
    sessionRestoreError: ApiError | null

    // 操作
    login: (credentials: LoginCredentials) => Promise<void>
    logout: () => void
    restoreSession: () => Promise<boolean>
    refreshServerVersion: () => Promise<void>
    updateServerVersion: (
        version: string | null,
        buildDate?: string | null,
        source?: 'header' | 'version',
        minPanelVersion?: string | null,
        features?: ServerFeatureFlags,
    ) => void
    updateConnectionStatus: (status: ConnectionStatus, error?: string | null) => void
}

let restoreSessionPromise: Promise<boolean> | null              = null
let persistedAuthRestoreFailed                                  = false
let persistedAuthValueInvalid                                   = false
let authStorageHydrating                                        = true
let authStorageWritesEnabled                                    = true
let authStoragePersistent                                       = false
let authStorageWriteGeneration                                  = 0
let authStorageWriteSequence                                    = 0
let authStorageTransactionSequence                              = 0
let activeAuthStorageTransaction: AuthStorageTransaction | null = null
let hydratedLegacyCredentials: RestorableAuthCredentials | null = null

const authHydrationWaiters              = new Set<() => void>()
const STORAGE_KEY_AUTH_CREDENTIALS      = `${STORAGE_KEY_AUTH}:credentials`
const STORAGE_KEY_AUTH_INTENT           = `${STORAGE_KEY_AUTH}:intent`
const STORAGE_KEY_AUTH_TRANSACTION      = `${STORAGE_KEY_AUTH}:transaction`
const STORAGE_KEY_AUTH_INVALIDATED      = `${STORAGE_KEY_AUTH}:invalidated`
const AUTH_STORAGE_LOCK_NAME            = `${STORAGE_KEY_AUTH}:storage-lock`
const EXPECTED_AUTH_STORAGE_TRANSACTION = Symbol('expected-auth-storage-transaction')
const AUTH_INVALIDATED_HISTORY_STATE    = '__cpamAuthInvalidated'
const AUTH_INVALIDATED_COOKIE_PREFIX    = 'cpam_auth_invalidated_'

type AuthLoginCredentials = LoginCredentials & {
    [EXPECTED_AUTH_STORAGE_TRANSACTION]?: string | null
}

class AuthStorageSupersededError extends Error {
    override name = 'AuthStorageSupersededError'
}

function finishAuthHydration(): void {
    for (const resolve of authHydrationWaiters) {
        resolve()
    }
    authHydrationWaiters.clear()
}

function hasSessionInvalidationBarrier(): boolean {
    try {
        return sessionStorage.getItem(STORAGE_KEY_AUTH_INVALIDATED) === 'true'
    } catch {
        persistedAuthRestoreFailed = true
        return true
    }
}

function setSessionInvalidationBarrier(): boolean {
    try {
        sessionStorage.setItem(STORAGE_KEY_AUTH_INVALIDATED, 'true')
        return true
    } catch {
        return false
    }
}

function clearSessionInvalidationBarrier(): boolean {
    try {
        sessionStorage.removeItem(STORAGE_KEY_AUTH_INVALIDATED)
        return true
    } catch {
        try {
            sessionStorage.setItem(STORAGE_KEY_AUTH_INVALIDATED, 'false')
            return true
        } catch {
            return false
        }
    }
}

function hasHistoryInvalidationBarrier(): boolean {
    if (typeof history === 'undefined') {
        return false
    }
    try {
        const state = history.state as unknown
        return state !== null && typeof state === 'object' &&
               (state as Record<string, unknown>)[AUTH_INVALIDATED_HISTORY_STATE] === true
    } catch {
        persistedAuthRestoreFailed = true
        return true
    }
}

function setHistoryInvalidationBarrier(): boolean {
    if (typeof history === 'undefined') {
        return false
    }
    try {
        const state                               = history.state as unknown
        const nextState                           = state !== null && typeof state === 'object' ?
            { ...state as Record<string, unknown> } : {}
        nextState[AUTH_INVALIDATED_HISTORY_STATE] = true
        history.replaceState(nextState, '')
        return hasHistoryInvalidationBarrier()
    } catch {
        return false
    }
}

function clearHistoryInvalidationBarrier(): boolean {
    if (typeof history === 'undefined') {
        return true
    }
    try {
        const state = history.state as unknown
        if (state === null || typeof state !== 'object') {
            return true
        }
        const nextState = { ...state as Record<string, unknown> }
        delete nextState[AUTH_INVALIDATED_HISTORY_STATE]
        history.replaceState(nextState, '')
        return !hasHistoryInvalidationBarrier()
    } catch {
        return false
    }
}

function getInvalidationCookieName(): string {
    let origin = 'unknown'
    try {
        origin = `${window.location.protocol}//${window.location.host}`
    } catch {
        // 使用稳定的保守命名
    }
    const suffix = [...origin]
        .map((character) => character.codePointAt(0)?.toString(16).padStart(4, '0') ?? '0000')
        .join('')
    return `${AUTH_INVALIDATED_COOKIE_PREFIX}${suffix}`
}

function hasCookieInvalidationBarrier(): boolean {
    if (typeof document === 'undefined') {
        return false
    }
    try {
        const cookieName = getInvalidationCookieName()
        return document.cookie
                       .split(';')
                       .some((cookie) => cookie.trim() === `${cookieName}=1`)
    } catch {
        persistedAuthRestoreFailed = true
        return true
    }
}

function setCookieInvalidationBarrier(): boolean {
    if (typeof document === 'undefined') {
        return false
    }
    try {
        const secure    = typeof window !== 'undefined' && window.isSecureContext ? '; Secure' : ''
        document.cookie = `${getInvalidationCookieName()}=1; Max-Age=31536000; Path=/; SameSite=Strict${secure}`
        return hasCookieInvalidationBarrier()
    } catch {
        return false
    }
}

function clearCookieInvalidationBarrier(): boolean {
    if (typeof document === 'undefined') {
        return true
    }
    try {
        const secure    = typeof window !== 'undefined' && window.isSecureContext ? '; Secure' : ''
        document.cookie = `${getInvalidationCookieName()}=; Max-Age=0; Path=/; SameSite=Strict${secure}`
        return !hasCookieInvalidationBarrier()
    } catch {
        return false
    }
}

function hasBrowserInvalidationBarrier(): boolean {
    return hasSessionInvalidationBarrier() ||
           hasHistoryInvalidationBarrier() ||
           hasCookieInvalidationBarrier()
}

function setBrowserInvalidationBarrier(): boolean {
    let stored = setSessionInvalidationBarrier()
    stored     = setHistoryInvalidationBarrier() || stored
    stored     = setCookieInvalidationBarrier() || stored
    return stored
}

function clearBrowserInvalidationBarrier(): boolean {
    let cleared = clearSessionInvalidationBarrier()
    cleared     = clearHistoryInvalidationBarrier() && cleared
    cleared     = clearCookieInvalidationBarrier() && cleared
    return cleared
}

function hasRememberedLoginMarker(): boolean {
    if (hasBrowserInvalidationBarrier()) {
        return false
    }
    try {
        return localStorage.getItem('isLoggedIn') === 'true'
    } catch {
        persistedAuthRestoreFailed = true
        return false
    }
}

function setRememberedLoginMarker(): boolean {
    try {
        localStorage.setItem('isLoggedIn', 'true')
        return true
    } catch {
        return false
    }
}

function clearRememberedLoginMarker(): boolean {
    try {
        localStorage.removeItem('isLoggedIn')
        return true
    } catch {
        try {
            localStorage.setItem('isLoggedIn', 'false')
            return true
        } catch {
            return false
        }
    }
}

async function withAuthStorageLock<T>(
    operation: () => Promise<T> | T,
): Promise<AuthStorageLockResult<T>> {
    try {
        if (typeof navigator === 'undefined' || typeof navigator.locks?.request !== 'function') {
            return { status: 'unsupported', value: null }
        }
        const value = await navigator.locks.request(AUTH_STORAGE_LOCK_NAME, async () => operation())
        return { status: 'acquired', value }
    } catch {
        return { status: 'failed', value: null }
    }
}

function createAuthStorageTransactionId(): string {
    try {
        if (typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID()
        }
    } catch {
        // 使用无敏感信息的本地唯一值
    }
    authStorageTransactionSequence += 1
    const timestamp = Date.now().toString(36)
    const sequence  = authStorageTransactionSequence.toString(36)
    const random    = Math.random().toString(36).slice(2)
    return `${timestamp}-${sequence}-${random}`
}

function authTransactionStorage(persistent: boolean): Storage {
    return persistent ? localStorage : sessionStorage
}

function writeAuthStorageTransaction(persistent: boolean, transactionId: string): boolean {
    try {
        const storage = authTransactionStorage(persistent)
        storage.setItem(STORAGE_KEY_AUTH_TRANSACTION, transactionId)
        return storage.getItem(STORAGE_KEY_AUTH_TRANSACTION) === transactionId
    } catch {
        return false
    }
}

function matchAuthStorageTransaction(
    persistent: boolean,
    transactionId: string,
): 'match' | 'mismatch' | 'unreadable' {
    try {
        return authTransactionStorage(persistent).getItem(STORAGE_KEY_AUTH_TRANSACTION) === transactionId ?
               'match' : 'mismatch'
    } catch {
        return 'unreadable'
    }
}

function writeAuthStorageIntent(persistent: boolean, transactionId: string): boolean {
    try {
        const storage = authTransactionStorage(persistent)
        storage.setItem(STORAGE_KEY_AUTH_INTENT, transactionId)
        return storage.getItem(STORAGE_KEY_AUTH_INTENT) === transactionId
    } catch {
        return false
    }
}

function matchAuthStorageIntent(
    persistent: boolean,
    transactionId: string,
): 'match' | 'mismatch' | 'unreadable' {
    try {
        return authTransactionStorage(persistent).getItem(STORAGE_KEY_AUTH_INTENT) === transactionId ?
               'match' : 'mismatch'
    } catch {
        return 'unreadable'
    }
}

function readAuthStorageTransaction(
    persistent: boolean,
): { status: 'value'; value: string } | { status: 'absent' | 'unreadable'; value: null } {
    try {
        const value = authTransactionStorage(persistent).getItem(STORAGE_KEY_AUTH_TRANSACTION)
        return value === null ? { status: 'absent', value: null } : { status: 'value', value }
    } catch {
        return { status: 'unreadable', value: null }
    }
}

function readAuthStorageIntent(
    persistent: boolean,
): { status: 'value'; value: string } | { status: 'absent' | 'unreadable'; value: null } {
    try {
        const value = authTransactionStorage(persistent).getItem(STORAGE_KEY_AUTH_INTENT)
        return value === null ? { status: 'absent', value: null } : { status: 'value', value }
    } catch {
        return { status: 'unreadable', value: null }
    }
}

function matchExpectedAuthStorageState(
    persistent: boolean,
    expectedTransactionId: string | null,
): 'match' | 'mismatch' | 'unreadable' {
    const transaction = readAuthStorageTransaction(persistent)
    const intent      = readAuthStorageIntent(persistent)
    if (transaction.status === 'unreadable' || intent.status === 'unreadable') {
        return 'unreadable'
    }
    if (expectedTransactionId === null) {
        return transaction.status === 'absent' && intent.status === 'absent' ? 'match' : 'mismatch'
    }
    return transaction.status === 'value' && transaction.value === expectedTransactionId &&
           intent.status === 'value' && intent.value === expectedTransactionId ?
           'match' : 'mismatch'
}

function matchAuthStorageIntents(
    transaction: AuthStorageTransaction,
): 'match' | 'mismatch' | 'unreadable' {
    for (const persistent of [true, false]) {
        const match = matchAuthStorageIntent(persistent, transaction.id)
        if (match !== 'match') {
            return match
        }
    }
    return 'match'
}

function restoreAuthStorageIntentsUnlocked(transaction: AuthStorageTransaction): boolean {
    let restored = true
    for (const persistent of [true, false]) {
        if (matchAuthStorageIntent(persistent, transaction.id) !== 'match') {
            continue
        }
        const committed = readAuthStorageTransaction(persistent)
        if (committed.status === 'value') {
            restored = writeAuthStorageIntent(persistent, committed.value) && restored
        } else if (committed.status === 'absent') {
            restored = secureStorage.removeItem(STORAGE_KEY_AUTH_INTENT, {
                persistent,
                clearAlternate: false,
            }) && restored
        } else {
            restored = false
        }
    }
    return restored
}

async function restoreAuthStorageIntents(transaction: AuthStorageTransaction): Promise<boolean> {
    if (!transaction.lockAvailable) {
        return false
    }
    const result = await withAuthStorageLock(() => restoreAuthStorageIntentsUnlocked(transaction))
    if (result.status === 'acquired' && result.value) {
        return true
    }
    setBrowserInvalidationBarrier()
    return false
}

function commitAuthStorageTransaction(
    transaction: AuthStorageTransaction,
): 'committed' | 'superseded' | 'failed' {
    const intentMatch = matchAuthStorageIntents(transaction)
    if (intentMatch !== 'match') {
        return intentMatch === 'mismatch' ? 'superseded' : 'failed'
    }
    if (!writeAuthStorageTransaction(transaction.persistent, transaction.id)) {
        return 'failed'
    }
    if (!secureStorage.removeItem(STORAGE_KEY_AUTH_TRANSACTION, {
        persistent: !transaction.persistent,
        clearAlternate: false,
    })) {
        return 'failed'
    }
    const finalMatch = matchAuthStorageIntents(transaction)
    return finalMatch === 'match' ? 'committed' : finalMatch === 'mismatch' ? 'superseded' : 'failed'
}

async function beginAuthStorageTransaction(
    persistent: boolean,
    expectedTransactionId?: string | null,
): Promise<AuthStorageTransaction> {
    const transaction: AuthStorageTransaction = {
        id: createAuthStorageTransactionId(),
        persistent,
        lockAvailable: false,
        superseded: false,
    }
    activeAuthStorageTransaction              = transaction
    const initialized                         = await withAuthStorageLock((): 'ready' | 'failed' | 'superseded' => {
        if (expectedTransactionId !== undefined &&
            matchExpectedAuthStorageState(persistent, expectedTransactionId) !== 'match') {
            return 'superseded'
        }
        const localWritten   = writeAuthStorageIntent(true, transaction.id)
        const sessionWritten = writeAuthStorageIntent(false, transaction.id)
        if (localWritten && sessionWritten) {
            return 'ready'
        }
        restoreAuthStorageIntentsUnlocked(transaction)
        return 'failed'
    })
    transaction.lockAvailable                 = initialized.status === 'acquired' && initialized.value === 'ready'
    transaction.superseded                    = initialized.status === 'acquired' ?
                                                initialized.value === 'superseded' :
                                                expectedTransactionId !== undefined
    return transaction
}

function hasStoredAuthenticationValue(): boolean {
    const keys = [
        STORAGE_KEY_AUTH,
        STORAGE_KEY_AUTH_CREDENTIALS,
        STORAGE_KEY_AUTH_INTENT,
        STORAGE_KEY_AUTH_TRANSACTION,
        'apiBase',
        'apiUrl',
        'managementKey',
    ]
    try {
        if (localStorage.getItem('isLoggedIn') !== null) {
            return true
        }
        return [localStorage, sessionStorage].some((storage) =>
                                                       keys.some((key) => storage.getItem(key) !== null))
    } catch {
        return true
    }
}

function clearLegacyStoredAuthentication(): boolean {
    let cleared = true
    for (const key of [STORAGE_KEY_AUTH, 'apiBase', 'apiUrl', 'managementKey']) {
        cleared = secureStorage.removeItem(key, { persistent: false }) && cleared
    }
    return cleared
}

function clearStoredAuthenticationUnlocked(): boolean {
    setBrowserInvalidationBarrier()
    let cleared = clearLegacyStoredAuthentication()
    cleared     = secureStorage.removeItem(STORAGE_KEY_AUTH_CREDENTIALS, { persistent: false }) && cleared
    cleared     = secureStorage.removeItem(STORAGE_KEY_AUTH_INTENT, { persistent: false }) && cleared
    cleared     = secureStorage.removeItem(STORAGE_KEY_AUTH_TRANSACTION, { persistent: false }) && cleared
    cleared     = clearRememberedLoginMarker() && cleared
    if (!cleared) {
        return false
    }
    return clearBrowserInvalidationBarrier()
}

async function clearStoredAuthentication(): Promise<boolean> {
    const result = await withAuthStorageLock(clearStoredAuthenticationUnlocked)
    if (result.status === 'acquired') {
        return result.value
    }
    if (result.status === 'unsupported') {
        return clearStoredAuthenticationUnlocked()
    }
    setBrowserInvalidationBarrier()
    clearCurrentSessionAuthentication()
    return false
}

function suspendStoredAuthentication(): void {
    authStorageWriteGeneration += 1
    authStorageWritesEnabled = false
}

function prepareStoredAuthenticationInvalidation(): void {
    suspendStoredAuthentication()
    authStoragePersistent        = false
    activeAuthStorageTransaction = null
    hydratedLegacyCredentials    = null
}

async function invalidateStoredAuthentication(): Promise<boolean> {
    prepareStoredAuthenticationInvalidation()
    return clearStoredAuthentication()
}

function clearCurrentSessionAuthentication(): boolean {
    let cleared = setSessionInvalidationBarrier()
    for (const key of [
        STORAGE_KEY_AUTH,
        STORAGE_KEY_AUTH_CREDENTIALS,
        STORAGE_KEY_AUTH_INTENT,
        STORAGE_KEY_AUTH_TRANSACTION,
        'apiBase',
        'apiUrl',
        'managementKey',
    ]) {
        cleared = secureStorage.removeItem(key, {
            persistent: false,
            clearAlternate: false,
        }) && cleared
    }
    return cleared
}

function clearSupersededSessionAuthentication(transaction: AuthStorageTransaction): boolean {
    let cleared = clearCurrentSessionAuthentication()
    if (transaction.persistent && matchAuthStorageTransaction(true, transaction.id) === 'match') {
        cleared = secureStorage.removeItem(STORAGE_KEY_AUTH_CREDENTIALS, {
            persistent: true,
            clearAlternate: false,
        }) && cleared
        cleared = secureStorage.removeItem(STORAGE_KEY_AUTH_TRANSACTION, {
            persistent: true,
            clearAlternate: false,
        }) && cleared
        cleared = clearRememberedLoginMarker() && cleared
    }
    return cleared
}

async function invalidateAuthenticationForActiveTransaction(): Promise<boolean> {
    const transaction = activeAuthStorageTransaction
    prepareStoredAuthenticationInvalidation()
    const invalidate = () => {
        if (!transaction || matchAuthStorageIntent(true, transaction.id) !== 'mismatch') {
            return clearStoredAuthenticationUnlocked()
        }
        return clearSupersededSessionAuthentication(transaction)
    }
    const result     = await withAuthStorageLock(invalidate)
    if (result.status === 'acquired') {
        return result.value
    }
    if (result.status === 'unsupported') {
        return invalidate()
    }
    setBrowserInvalidationBarrier()
    clearCurrentSessionAuthentication()
    return false
}

async function storeAuthentication(
    transaction: AuthStorageTransaction,
    storageWriteGeneration: number,
    apiBase: string,
    managementKey: string,
    rememberPassword: boolean,
): Promise<AuthStorageCommitResult> {
    const currentStatus     = (): 'current' | 'superseded' | 'unreadable' => {
        if (storageWriteGeneration !== authStorageWriteGeneration) {
            return 'superseded'
        }
        const intentMatch = matchAuthStorageIntents(transaction)
        return intentMatch === 'match' ? 'current' : intentMatch === 'mismatch' ? 'superseded' : 'unreadable'
    }
    const clearAfterFailure = (): AuthStorageCommitResult => ({
        status: 'memory-only',
        clearFailed: !clearStoredAuthenticationUnlocked(),
    })

    if (!transaction.lockAvailable) {
        return {
            status: 'memory-only',
            clearFailed: !(await clearStoredAuthentication()),
        }
    }

    const locked = await withAuthStorageLock(async (): Promise<AuthStorageCommitResult> => {
        const initialStatus = currentStatus()
        if (initialStatus === 'superseded') {
            return { status: 'superseded', clearFailed: false }
        }
        if (initialStatus === 'unreadable') {
            return clearAfterFailure()
        }

        const storageResult    = await secureStorage.setItem(
            STORAGE_KEY_AUTH_CREDENTIALS,
            {
                version: 1,
                apiBase,
                managementKey,
                transactionId: transaction.id,
            } satisfies StoredAuthCredentials,
            {
                encrypt: true,
                persistent: rememberPassword,
                clearAlternate: true,
                shouldCommit: () => currentStatus() === 'current',
            },
        )
        const statusAfterWrite = currentStatus()
        if (statusAfterWrite === 'superseded') {
            if (storageResult === 'stored') {
                clearStoredAuthenticationUnlocked()
            }
            return { status: 'superseded', clearFailed: false }
        }
        if (storageResult !== 'stored' || statusAfterWrite === 'unreadable') {
            return clearAfterFailure()
        }

        const commitResult = commitAuthStorageTransaction(transaction)
        if (commitResult === 'superseded') {
            clearStoredAuthenticationUnlocked()
            return { status: 'superseded', clearFailed: false }
        }
        if (commitResult !== 'committed' || !clearLegacyStoredAuthentication()) {
            return clearAfterFailure()
        }

        const markerUpdated = rememberPassword ?
                              setRememberedLoginMarker() :
                              clearRememberedLoginMarker()
        if (!markerUpdated || !clearBrowserInvalidationBarrier()) {
            return clearAfterFailure()
        }
        return { status: 'stored', clearFailed: false }
    })

    if (locked.status === 'acquired') {
        return locked.value
    }
    return {
        status: 'memory-only',
        clearFailed: !(await clearStoredAuthentication()),
    }
}

function markPersistedAuthUnreadable(): void {
    persistedAuthRestoreFailed = true
}

function markPersistedAuthRestoreFailed(): void {
    persistedAuthRestoreFailed = true
    persistedAuthValueInvalid  = true
}

const isStringStorageValue = (value: unknown): value is string => typeof value === 'string'

function normalizeRestorableCredentials(
    apiBase: string,
    managementKey: string,
    persistent: boolean,
    source: RestorableAuthCredentials['source'] = 'legacy',
): RestorableAuthCredentials | null {
    const normalizedBase = normalizeApiBase(apiBase)
    const normalizedKey  = managementKey.trim()
    if (!normalizedBase || !normalizedKey) {
        return null
    }
    return {
        apiBase: normalizedBase,
        managementKey: normalizedKey,
        persistent,
        source,
        storageTransactionId: null,
    }
}

function sameCredentials(left: RestorableAuthCredentials, right: RestorableAuthCredentials): boolean {
    return left.apiBase === right.apiBase && left.managementKey === right.managementKey
}

function isStoredAuthCredentials(value: unknown): value is StoredAuthCredentials {
    if (value === null || typeof value !== 'object') {
        return false
    }
    const credentials = value as Partial<StoredAuthCredentials>
    return credentials.version === 1 &&
           typeof credentials.apiBase === 'string' &&
           typeof credentials.managementKey === 'string' &&
           typeof credentials.transactionId === 'string' &&
           credentials.transactionId.length > 0 &&
           normalizeRestorableCredentials(credentials.apiBase, credentials.managementKey, false) !== null
}

function rejectPersistedAuthState(name: string): null {
    markPersistedAuthRestoreFailed()
    secureStorage.removeItem(name, { persistent: false })
    return null
}

function preparePersistedAuthState(name: string, value: string | null, persistent: boolean): string | null {
    if (value === null) {
        return null
    }
    try {
        const parsed = JSON.parse(value) as { state?: unknown; version?: unknown }
        if (!parsed || typeof parsed !== 'object' || !parsed.state || typeof parsed.state !== 'object') {
            return rejectPersistedAuthState(name)
        }
        if (parsed.version !== undefined && typeof parsed.version !== 'number') {
            return rejectPersistedAuthState(name)
        }
        const state = parsed.state as Record<string, unknown>
        for (const key of ['apiBase', 'managementKey']) {
            if (state[key] !== undefined && typeof state[key] !== 'string') {
                return rejectPersistedAuthState(name)
            }
        }
        if (state.rememberPassword !== undefined && typeof state.rememberPassword !== 'boolean') {
            return rejectPersistedAuthState(name)
        }
        for (const key of ['serverVersion', 'serverBuildDate', 'serverMinPanelVersion']) {
            if (state[key] !== undefined && state[key] !== null && typeof state[key] !== 'string') {
                return rejectPersistedAuthState(name)
            }
        }
        if (state.serverVersionSource !== undefined &&
            state.serverVersionSource !== null &&
            state.serverVersionSource !== 'header' &&
            state.serverVersionSource !== 'version') {
            return rejectPersistedAuthState(name)
        }

        const apiBase       = typeof state.apiBase === 'string' ? state.apiBase : ''
        const managementKey = typeof state.managementKey === 'string' ? state.managementKey : ''
        if (Boolean(apiBase.trim()) !== Boolean(managementKey.trim())) {
            return rejectPersistedAuthState(name)
        }
        if (apiBase.trim() && managementKey.trim()) {
            const credentials = normalizeRestorableCredentials(apiBase, managementKey, persistent)
            if (!credentials ||
                hydratedLegacyCredentials && !sameCredentials(hydratedLegacyCredentials, credentials)) {
                return rejectPersistedAuthState(name)
            }
            hydratedLegacyCredentials = credentials
        }

        const sanitizedState: Record<string, unknown> = {}
        for (const key of [
            'serverVersion',
            'serverBuildDate',
            'serverMinPanelVersion',
            'serverVersionSource',
        ]) {
            if (state[key] !== undefined) {
                sanitizedState[key] = state[key]
            }
        }
        return JSON.stringify({
                                  state: sanitizedState,
                                  ...(typeof parsed.version === 'number' ? { version: parsed.version } : {}),
                              })
    } catch {
        return rejectPersistedAuthState(name)
    }
}

async function readCredentialBundle(
    persistent: boolean,
    shouldCommit: () => boolean,
): Promise<AuthCredentialsReadResult> {
    const result = await secureStorage.getItemResult<StoredAuthCredentials>(STORAGE_KEY_AUTH_CREDENTIALS, {
        persistent,
        fallbackToPersistent: false,
        shouldCommit,
        validate: isStoredAuthCredentials,
    })
    if (result.status !== 'value') {
        return result
    }
    const transactionMatch = matchAuthStorageTransaction(persistent, result.value.transactionId)
    if (transactionMatch !== 'match') {
        return { status: transactionMatch === 'unreadable' ? 'unreadable' : 'invalid', value: null }
    }
    const intentMatches = [matchAuthStorageIntent(persistent, result.value.transactionId)]
    if (!persistent) {
        intentMatches.push(matchAuthStorageIntent(true, result.value.transactionId))
    }
    if (intentMatches.includes('unreadable')) {
        return { status: 'unreadable', value: null }
    }
    if (intentMatches.includes('mismatch')) {
        return { status: 'cancelled', value: null }
    }
    const credentials = normalizeRestorableCredentials(
        result.value.apiBase,
        result.value.managementKey,
        persistent,
        'bundle',
    )
    return credentials ? {
        status: 'value',
        value: {
            ...credentials,
            storageTransactionId: result.value.transactionId,
        },
    } : { status: 'invalid', value: null }
}

async function readLegacyCredentialPair(
    persistent: boolean,
    shouldCommit: () => boolean,
): Promise<AuthCredentialsReadResult> {
    const options                                            = {
        persistent,
        fallbackToPersistent: false,
        shouldCommit,
        validate: isStringStorageValue,
    }
    const [apiBaseResult, apiUrlResult, managementKeyResult] = await Promise.all([
                                                                                     secureStorage.getItemResult<string>(
                                                                                         'apiBase',
                                                                                         options,
                                                                                     ),
                                                                                     secureStorage.getItemResult<string>(
                                                                                         'apiUrl',
                                                                                         options,
                                                                                     ),
                                                                                     secureStorage.getItemResult<string>(
                                                                                         'managementKey',
                                                                                         options,
                                                                                     ),
                                                                                 ])
    const results                                            = [apiBaseResult, apiUrlResult, managementKeyResult]
    for (const status of ['cancelled', 'invalid', 'unreadable'] as const) {
        if (results.some((result) => result.status === status)) {
            return { status, value: null }
        }
    }

    const apiBase = apiBaseResult.status === 'value' ? normalizeApiBase(apiBaseResult.value) : ''
    const apiUrl  = apiUrlResult.status === 'value' ? normalizeApiBase(apiUrlResult.value) : ''
    const key     = managementKeyResult.status === 'value' ? managementKeyResult.value.trim() : ''
    if (apiBase && apiUrl && apiBase !== apiUrl) {
        return { status: 'invalid', value: null }
    }
    const selectedBase   = apiBase || apiUrl
    const hasStoredValue = results.some((result) => result.status === 'value')
    if (!hasStoredValue) {
        return { status: 'absent', value: null }
    }
    const credentials = normalizeRestorableCredentials(selectedBase, key, persistent)
    return credentials ? { status: 'value', value: credentials } : { status: 'invalid', value: null }
}

function resolveCredentialCandidates(
    candidates: RestorableAuthCredentials[],
): AuthCredentialsReadResult {
    if (candidates.length === 0) {
        return { status: 'absent', value: null }
    }
    const first = candidates[0]
    if (candidates.some((candidate) => !sameCredentials(first, candidate))) {
        return { status: 'invalid', value: null }
    }
    return {
        status: 'value',
        value: {
            ...first,
            persistent: candidates.some((candidate) => candidate.persistent),
        },
    }
}

function resolveLegacyCredentialSource(
    result: AuthCredentialsReadResult,
    persistent: boolean,
): AuthCredentialsReadResult {
    if (result.status !== 'value' && result.status !== 'absent') {
        return result
    }
    const candidates: RestorableAuthCredentials[] = []
    if (result.status === 'value') {
        candidates.push(result.value)
    }
    if (hydratedLegacyCredentials?.persistent === persistent) {
        candidates.push(hydratedLegacyCredentials)
    }
    return resolveCredentialCandidates(candidates)
}

async function readStoredAuthCredentials(
    remembered: boolean,
    shouldCommit: () => boolean,
): Promise<AuthCredentialsReadResult> {
    if (remembered) {
        const persistentBundle = await readCredentialBundle(true, shouldCommit)
        if (persistentBundle.status !== 'absent') {
            return persistentBundle
        }
        const persistentTransaction = readAuthStorageTransaction(true)
        if (persistentTransaction.status !== 'absent') {
            return {
                status: persistentTransaction.status === 'unreadable' ? 'unreadable' : 'invalid',
                value: null,
            }
        }
        const persistentIntent = readAuthStorageIntent(true)
        if (persistentIntent.status !== 'absent') {
            return {
                status: persistentIntent.status === 'unreadable' ? 'unreadable' : 'cancelled',
                value: null,
            }
        }
    }

    const sessionBundle = await readCredentialBundle(false, shouldCommit)
    if (sessionBundle.status !== 'absent') {
        return sessionBundle
    }
    const sessionTransaction = readAuthStorageTransaction(false)
    if (sessionTransaction.status !== 'absent') {
        return {
            status: sessionTransaction.status === 'unreadable' ? 'unreadable' : 'invalid',
            value: null,
        }
    }
    const sessionIntent = readAuthStorageIntent(false)
    if (sessionIntent.status !== 'absent') {
        return {
            status: sessionIntent.status === 'unreadable' ? 'unreadable' : 'cancelled',
            value: null,
        }
    }

    if (remembered) {
        const persistentLegacy = resolveLegacyCredentialSource(
            await readLegacyCredentialPair(true, shouldCommit),
            true,
        )
        if (persistentLegacy.status !== 'absent') {
            return persistentLegacy
        }
    }

    return resolveLegacyCredentialSource(
        await readLegacyCredentialPair(false, shouldCommit),
        false,
    )
}

export const useAuthStore = create<AuthStoreState>()(
    persist(
        (set, get) => ({
            // 初始状态
            isAuthenticated: false,
            apiBase: '',
            managementKey: '',
            rememberPassword: false,
            serverVersion: null,
            serverBuildDate: null,
            serverMinPanelVersion: null,
            serverFeatures: {},
            serverVersionSource: null,
            storageRestoreFailed: false,
            storagePersistenceFailed: false,
            storageClearFailed: false,
            sessionRestoreStatus: 'idle',
            sessionRestoreError: null,
            connectionStatus: 'disconnected',
            connectionError: null,
            hydrated: false,

            // 恢复会话并自动登录
            restoreSession: () => {
                const currentStatus = get().sessionRestoreStatus
                if (currentStatus === 'succeeded') {
                    return Promise.resolve(get().isAuthenticated)
                }
                if (currentStatus === 'failed' || currentStatus === 'skipped') {
                    return Promise.resolve(false)
                }
                if (restoreSessionPromise) {
                    return restoreSessionPromise
                }
                const restoreGeneration = authStorageWriteGeneration
                set({ sessionRestoreStatus: 'restoring', sessionRestoreError: null })
                restoreSessionPromise = (async () => {
                    await waitForAuthHydration()

                    const isCurrentRestore = () =>
                        authStorageWritesEnabled &&
                        restoreGeneration === authStorageWriteGeneration &&
                        get().sessionRestoreStatus === 'restoring'
                    if (!isCurrentRestore()) {
                        return false
                    }

                    const lockedRestore = await withAuthStorageLock(async (): Promise<AuthStorageRestoreResult> => {
                        if (hasBrowserInvalidationBarrier()) {
                            const sharedInvalidation = hasCookieInvalidationBarrier()
                            prepareStoredAuthenticationInvalidation()
                            return {
                                status: 'invalidated',
                                storageCleared: sharedInvalidation ?
                                                clearStoredAuthenticationUnlocked() :
                                                clearCurrentSessionAuthentication(),
                            }
                        }
                        const remembered = hasRememberedLoginMarker()
                        return {
                            status: 'credentials',
                            credentials: await readStoredAuthCredentials(remembered, isCurrentRestore),
                        }
                    })
                    if (lockedRestore.status === 'acquired' && lockedRestore.value.status === 'invalidated') {
                        const resolvedBase = resolveApiBase(get().apiBase, null, detectApiBaseFromLocation())
                        apiClient.setConfig({ apiBase: resolvedBase, managementKey: '' })
                        set({
                                apiBase: resolvedBase,
                                managementKey: '',
                                rememberPassword: false,
                                storageRestoreFailed: true,
                                storagePersistenceFailed: !lockedRestore.value.storageCleared,
                                storageClearFailed: !lockedRestore.value.storageCleared,
                                sessionRestoreStatus: 'failed',
                                sessionRestoreError: null,
                            })
                        return false
                    }
                    let storedCredentials: AuthCredentialsReadResult = { status: 'absent', value: null }
                    if (lockedRestore.status !== 'acquired' && hasStoredAuthenticationValue()) {
                        storedCredentials = { status: 'unreadable', value: null }
                    } else if (lockedRestore.status === 'acquired' && lockedRestore.value.status === 'credentials') {
                        storedCredentials = lockedRestore.value.credentials
                    }
                    if (storedCredentials.status === 'cancelled') {
                        if (isCurrentRestore()) {
                            set({ sessionRestoreStatus: 'skipped', sessionRestoreError: null })
                        }
                        return false
                    }
                    const usesLegacyCredentials = storedCredentials.status === 'value' &&
                                                  storedCredentials.value.source === 'legacy'
                    let storageRestoreFailed    = (storedCredentials.status === 'absent' || usesLegacyCredentials) &&
                                                  persistedAuthRestoreFailed
                    let storageValueInvalid     = storageRestoreFailed && persistedAuthValueInvalid
                    if (storedCredentials.status === 'invalid') {
                        storageRestoreFailed = true
                        storageValueInvalid  = true
                        clearRememberedLoginMarker()
                    } else if (storedCredentials.status === 'unreadable') {
                        storageRestoreFailed = true
                        storageValueInvalid  = false
                    }

                    if (!isCurrentRestore()) {
                        return false
                    }

                    const restoredCredentials      = storedCredentials.status === 'value' ?
                                                     storedCredentials.value :
                                                     null
                    const resolvedBase             = resolveApiBase(
                        restoredCredentials?.apiBase || '',
                        null,
                        detectApiBaseFromLocation(),
                    )
                    const resolvedKey              = restoredCredentials?.managementKey || ''
                    const resolvedRememberPassword = restoredCredentials?.persistent ?? false

                    if (storageRestoreFailed) {
                        let storageCleared = true
                        if (storageValueInvalid) {
                            storageCleared = await invalidateStoredAuthentication()
                        } else {
                            suspendStoredAuthentication()
                        }
                        apiClient.setConfig({ apiBase: resolvedBase, managementKey: '' })
                        set({
                                apiBase: resolvedBase,
                                managementKey: '',
                                rememberPassword: false,
                                storageRestoreFailed: true,
                                storagePersistenceFailed: !storageCleared,
                                storageClearFailed: !storageCleared,
                                sessionRestoreStatus: 'failed',
                                sessionRestoreError: null,
                            })
                        return false
                    }

                    set({
                            apiBase: resolvedBase,
                            managementKey: resolvedKey,
                            rememberPassword: resolvedRememberPassword,
                            storageRestoreFailed: false,
                        })
                    apiClient.setConfig({ apiBase: resolvedBase, managementKey: resolvedKey })

                    if (!resolvedBase || !resolvedKey || !restoredCredentials) {
                        hydratedLegacyCredentials = null
                        set({ sessionRestoreStatus: 'skipped', sessionRestoreError: null })
                        return false
                    }

                    try {
                        await get().login({
                                              apiBase: resolvedBase,
                                              managementKey: resolvedKey,
                                              rememberPassword: resolvedRememberPassword,
                                              [EXPECTED_AUTH_STORAGE_TRANSACTION]:
                                              restoredCredentials.storageTransactionId,
                                          } as AuthLoginCredentials)
                        set({ sessionRestoreStatus: 'succeeded', sessionRestoreError: null })
                        return true
                    } catch (error: unknown) {
                        const apiError = error as ApiError
                        console.warn('Auto login failed:', error)
                        set({ sessionRestoreStatus: 'failed', sessionRestoreError: apiError })
                        return false
                    }
                })().finally(() => {
                    restoreSessionPromise = null
                })

                return restoreSessionPromise
            },

            // 登录
            login: async (credentials) => {
                useModelsStore.getState().clearCache()
                useQuotaStore.getState().clearQuotaCache()
                useAuthFilesSummaryStore.getState().clear()
                clearAuthFileModelsCache()
                const apiBase                    = normalizeApiBase(credentials.apiBase)
                const managementKey              = credentials.managementKey.trim()
                const rememberPassword           = credentials.rememberPassword ?? get().rememberPassword ?? false
                const expectedStorageTransaction =
                          (credentials as AuthLoginCredentials)[EXPECTED_AUTH_STORAGE_TRANSACTION]
                authStorageWriteGeneration += 1
                authStorageWritesEnabled         = false
                hydratedLegacyCredentials        = null
                const storageWriteGeneration     = authStorageWriteGeneration
                const storageTransaction         = await beginAuthStorageTransaction(
                    rememberPassword,
                    expectedStorageTransaction,
                )

                try {
                    if (storageTransaction.superseded) {
                        // noinspection ExceptionCaughtLocallyJS
                        throw new AuthStorageSupersededError('Login storage operation was superseded')
                    }
                    set({
                            connectionStatus: 'connecting',
                            sessionRestoreError: null,
                            serverVersion: null,
                            serverBuildDate: null,
                            serverMinPanelVersion: null,
                            serverFeatures: {},
                            serverVersionSource: null,
                        })

                    // 配置 API 客户端
                    useConfigStore.getState().clearCache()
                    apiClient.setConfig({
                                            apiBase,
                                            managementKey,
                                        })

                    // 测试连接 - 获取配置
                    await useConfigStore.getState().fetchConfig(undefined, true)
                    await get()
                        .refreshServerVersion()
                        .catch((error) => {
                            console.warn('Fetch server version failed:', error)
                        })

                    if (storageWriteGeneration !== authStorageWriteGeneration) {
                        // noinspection ExceptionCaughtLocallyJS
                        throw new AuthStorageSupersededError('Login storage operation was superseded')
                    }
                    persistedAuthRestoreFailed = false
                    persistedAuthValueInvalid  = false

                    const storageCommit = await storeAuthentication(
                        storageTransaction,
                        storageWriteGeneration,
                        apiBase,
                        managementKey,
                        rememberPassword,
                    )
                    if (storageCommit.status === 'superseded') {
                        // noinspection ExceptionCaughtLocallyJS
                        throw new AuthStorageSupersededError('Login storage operation was superseded')
                    }
                    const storagePersistenceFailed = storageCommit.status === 'memory-only'
                    const storedRememberPassword   = rememberPassword && !storagePersistenceFailed
                    const storageClearFailed       = storageCommit.clearFailed
                    if (storagePersistenceFailed) {
                        activeAuthStorageTransaction = storageTransaction
                    } else {
                        authStoragePersistent    = rememberPassword
                        authStorageWritesEnabled = true
                    }

                    // 登录成功
                    set({
                            isAuthenticated: true,
                            apiBase,
                            managementKey,
                            rememberPassword: storedRememberPassword,
                            connectionStatus: 'connected',
                            connectionError: null,
                            storageRestoreFailed: false,
                            storagePersistenceFailed,
                            storageClearFailed,
                            sessionRestoreStatus: 'succeeded',
                            sessionRestoreError: null,
                        })
                } catch (error: unknown) {
                    const message              =
                              error instanceof Error ?
                              error.message :
                              typeof error === 'string' ? error : 'Connection failed'
                    const isCurrentLogin       = storageWriteGeneration === authStorageWriteGeneration
                    const storageSuperseded    = error instanceof AuthStorageSupersededError
                    const invalidCredentials   =
                              isCurrentLogin && (error as Partial<ApiError>).status === 401
                    let storageIntentsRestored = true
                    if (isCurrentLogin && !invalidCredentials && !storageSuperseded) {
                        storageIntentsRestored = await restoreAuthStorageIntents(storageTransaction)
                    }
                    const storageCleared = invalidCredentials ?
                                           await invalidateAuthenticationForActiveTransaction() :
                                           true
                    if (isCurrentLogin) {
                        if (storageSuperseded) {
                            apiClient.setConfig({ apiBase, managementKey: '' })
                        }
                        set({
                                isAuthenticated: false,
                                connectionStatus: 'error',
                                connectionError: message || 'Connection failed',
                                ...(invalidCredentials || storageSuperseded ? {
                                    managementKey: '',
                                    rememberPassword: false,
                                    storagePersistenceFailed: !storageCleared,
                                    storageClearFailed: !storageCleared,
                                    sessionRestoreStatus: 'failed' as const,
                                } : {}),
                                ...(!storageIntentsRestored ? {
                                    storagePersistenceFailed: true,
                                    storageClearFailed: true,
                                } : {}),
                            })
                    }
                    throw error
                }
            },

            // 登出
            logout: () => {
                restoreSessionPromise  = null
                const storageCleanup   = invalidateStoredAuthentication()
                const logoutGeneration = authStorageWriteGeneration
                apiClient.setConfig({ apiBase: '', managementKey: '' })
                useConfigStore.getState().clearCache()
                useModelsStore.getState().clearCache()
                useQuotaStore.getState().clearQuotaCache()
                useAuthFilesSummaryStore.getState().clear()
                clearAuthFileModelsCache()
                useUsageStatsStore.getState().clearUsageStats()
                set({
                        isAuthenticated: false,
                        apiBase: '',
                        managementKey: '',
                        serverVersion: null,
                        serverBuildDate: null,
                        serverMinPanelVersion: null,
                        serverFeatures: {},
                        serverVersionSource: null,
                        connectionStatus: 'disconnected',
                        connectionError: null,
                        storageRestoreFailed: false,
                        storagePersistenceFailed: false,
                        storageClearFailed: false,
                        sessionRestoreStatus: 'skipped',
                        sessionRestoreError: null,
                        hydrated: true,
                    })
                persistedAuthRestoreFailed = false
                persistedAuthValueInvalid  = false
                void storageCleanup.then((storageCleared) => {
                    if (logoutGeneration !== authStorageWriteGeneration || get().isAuthenticated) {
                        return
                    }
                    set({
                            storagePersistenceFailed: !storageCleared,
                            storageClearFailed: !storageCleared,
                        })
                })
            },

            refreshServerVersion: async () => {
                const authGeneration = apiClient.getAuthGeneration()
                try {
                    const info = await versionApi.get()
                    if (authGeneration !== apiClient.getAuthGeneration()) {
                        return
                    }
                    get().updateServerVersion(
                        info?.version || null,
                        info?.build_time || null,
                        'version',
                        info?.min_panel_version || null,
                        info?.features ?? {},
                    )
                } catch (error: unknown) {
                    if (error instanceof Error && /404/.test(error.message)) {
                        return
                    }
                    throw error
                }
            },

            // 更新服务器版本
            updateServerVersion: (version, buildDate, source = 'header', minPanelVersion = null, features = {}) => {
                const currentSource = get().serverVersionSource
                if (source === 'header' && currentSource === 'version') {
                    return
                }
                set((state) => ({
                    serverVersion: version || null,
                    serverBuildDate: buildDate || null,
                    serverMinPanelVersion: source === 'version' ? minPanelVersion || null : state.serverMinPanelVersion,
                    serverFeatures: source === 'version' ? features : state.serverFeatures,
                    serverVersionSource: version || buildDate ? source : null,
                }))
            },

            // 更新连接状态
            updateConnectionStatus: (status, error = null) => {
                set({
                        connectionStatus: status,
                        connectionError: error,
                    })
            },
        }),
        {
            name: STORAGE_KEY_AUTH,
            storage: createJSONStorage<AuthStoreState>(() => {
                const asyncStorage: StateStorage = {
                    getItem: async (name) => {
                        if (hasBrowserInvalidationBarrier()) {
                            return null
                        }
                        const readGeneration = authStorageWriteGeneration
                        const isCurrentRead  = () =>
                            authStorageWritesEnabled &&
                            readGeneration === authStorageWriteGeneration
                        if (hasRememberedLoginMarker()) {
                            const persistentRaw = await secureStorage.getItem<string>(name, {
                                encrypt: true,
                                persistent: true,
                                onInvalidEncryptedValue: markPersistedAuthRestoreFailed,
                                onUnreadableValue: markPersistedAuthUnreadable,
                                shouldCommit: isCurrentRead,
                                validate: isStringStorageValue,
                            })
                            if (!isCurrentRead()) {
                                return null
                            }
                            const preparedPersistent = preparePersistedAuthState(name, persistentRaw, true)
                            if (preparedPersistent !== null) {
                                return preparedPersistent
                            }
                        }
                        const sessionRaw = await secureStorage.getItem<string>(name, {
                            encrypt: true,
                            persistent: false,
                            fallbackToPersistent: false,
                            onInvalidEncryptedValue: markPersistedAuthRestoreFailed,
                            onUnreadableValue: markPersistedAuthUnreadable,
                            shouldCommit: isCurrentRead,
                            validate: isStringStorageValue,
                        })
                        return isCurrentRead() ? preparePersistedAuthState(name, sessionRaw, false) : null
                    },
                    setItem: async (name, value) => {
                        if (authStorageHydrating || persistedAuthRestoreFailed || !authStorageWritesEnabled) {
                            return
                        }
                        const writeGeneration = authStorageWriteGeneration
                        const writeSequence   = ++authStorageWriteSequence
                        const isCurrentWrite  = () =>
                            !authStorageHydrating &&
                            !persistedAuthRestoreFailed &&
                            authStorageWritesEnabled &&
                            writeGeneration === authStorageWriteGeneration &&
                            writeSequence === authStorageWriteSequence
                        await secureStorage.setItem(name, value, {
                            encrypt: true,
                            persistent: authStoragePersistent,
                            clearAlternate: true,
                            shouldCommit: isCurrentWrite,
                        })
                    },
                    removeItem: (name) => {
                        secureStorage.removeItem(name, { persistent: false })
                    },
                }
                return asyncStorage
            }),
            partialize: (state) =>
                ({
                    serverVersion: state.serverVersion,
                    serverBuildDate: state.serverBuildDate,
                    serverMinPanelVersion: state.serverMinPanelVersion,
                    serverVersionSource: state.serverVersionSource,
                }) as unknown as AuthStoreState,
            onRehydrateStorage: () => {
                authStorageHydrating = true
                return (_state, error) => {
                    if (error) {
                        markPersistedAuthRestoreFailed()
                    }
                    useAuthStore.setState({ hydrated: true })
                    authStorageHydrating = false
                    finishAuthHydration()
                }
            },
        },
    ),
)

function waitForAuthHydration(): Promise<void> {
    if (useAuthStore.persist.hasHydrated() || useAuthStore.getState().hydrated) {
        return Promise.resolve()
    }
    return new Promise((resolve) => {
        authHydrationWaiters.add(resolve)
    })
}

// 监听全局未授权事件，清理认证存储和会话缓存，但不触发 logout 以避免级联请求
if (typeof window !== 'undefined') {
    window.addEventListener('unauthorized', () => {
        restoreSessionPromise        = null
        const storageCleanup         = invalidateAuthenticationForActiveTransaction()
        const invalidationGeneration = authStorageWriteGeneration
        const state                  = useAuthStore.getState()
        if (state.isAuthenticated) {
            useModelsStore.getState().clearCache()
            useQuotaStore.getState().clearQuotaCache()
            useAuthFilesSummaryStore.getState().clear()
            clearAuthFileModelsCache()
        }
        useAuthStore.setState({
                                  isAuthenticated: false,
                                  managementKey: '',
                                  rememberPassword: false,
                                  connectionStatus: 'error',
                                  connectionError: 'Management key is invalid or expired',
                                  storagePersistenceFailed: false,
                                  storageClearFailed: false,
                                  hydrated: true,
                                  sessionRestoreStatus: 'failed',
                              })
        void storageCleanup.then((storageCleared) => {
            if (invalidationGeneration !== authStorageWriteGeneration || useAuthStore.getState().isAuthenticated) {
                return
            }
            useAuthStore.setState({
                                      storagePersistenceFailed: !storageCleared,
                                      storageClearFailed: !storageCleared,
                                  })
        })
    })

    window.addEventListener('server-version-update', ((e: CustomEvent) => {
        const detail = e.detail || {}
        useAuthStore.getState().updateServerVersion(detail.version || null, detail.buildDate || null, 'header')
    }) as EventListener)
}
