import assert from 'node:assert/strict'
import {AUTH_STORAGE_TEST_LOCK_NAME, installTestLockManager} from './browserLockManager'
import {installMemoryStorageEnvironment} from './memoryStorage'

const testLockManager = installTestLockManager()

const browserWindow       = installMemoryStorageEnvironment(true)
const localStorageValue   = globalThis.localStorage
const sessionStorageValue = globalThis.sessionStorage

let historyState: unknown = null
Object.defineProperty(globalThis, 'history', {
    configurable: true,
    writable: true,
    value: {
        get state() {
            return historyState
        },
        replaceState: (state: unknown) => {
            historyState = state
        },
    },
})

const cookies = new Map<string, string>()
Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: {
        get cookie() {
            return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
        },
        set cookie(serialized: string) {
            const [pair, ...attributes] = serialized.split(';').map((part) => part.trim())
            const separator             = pair.indexOf('=')
            const name                  = pair.slice(0, separator)
            const value                 = pair.slice(separator + 1)
            const expired               = attributes.some((attribute) => attribute.toLowerCase() === 'max-age=0')
            if (expired) {
                cookies.delete(name)
            } else {
                cookies.set(name, value)
            }
        },
    },
})

const delay             = (milliseconds = 20) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const AUTH_STORAGE_KEYS = [
    'cli-proxy-auth',
    'cli-proxy-auth:credentials',
    'cli-proxy-auth:intent',
    'cli-proxy-auth:transaction',
    'apiBase',
    'managementKey',
]

interface ReloadPayload {
    local: Record<string, string>
    session: Record<string, string>
    history: unknown
    cookies: Record<string, string>
    host: string
    port: string
    protocol: string
}

function snapshotStorage(storage: Storage): Record<string, string> {
    const snapshot: Record<string, string> = {}
    for (let index = 0; index < storage.length; ++index) {
        const key = storage.key(index)
        if (key) {
            snapshot[key] = storage.getItem(key) ?? ''
        }
    }
    return snapshot
}

function restoreStorage(storage: Storage, snapshot: Record<string, string>): void {
    for (const [key, value] of Object.entries(snapshot)) {
        storage.setItem(key, value)
    }
}

function installDecryptFailure(): void {
    const originalCrypto = globalThis.crypto
    const subtle         = new Proxy(originalCrypto.subtle, {
        get: (target, property) => {
            if (property === 'decrypt') {
                return async () => {
                    throw new Error('temporary decrypt failure')
                }
            }
            const value = Reflect.get(target, property, target)
            return typeof value === 'function' ? value.bind(target) : value
        },
    })
    const cryptoProxy    = new Proxy(originalCrypto, {
        get: (target, property) => {
            if (property === 'subtle') {
                return subtle
            }
            const value = Reflect.get(target, property, target)
            return typeof value === 'function' ? value.bind(target) : value
        },
    })
    Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        writable: true,
        value: cryptoProxy,
    })
}

async function seedAuthentication(
    persistent: boolean,
    managementKey: string,
    rawState?: Record<string, unknown>,
): Promise<{
    secureStorage: typeof import('../../src/services/storage/secureStorage').secureStorage
    snapshots: Record<string, string | null>
}> {
    const { secureStorage } = await import('../../src/services/storage/secureStorage')
    const apiBase           = 'https://example.test'
    const persistedState    = JSON.stringify({
                                                 state: rawState ?? {
                                                     apiBase,
                                                     managementKey,
                                                     rememberPassword: persistent,
                                                     serverVersion: null,
                                                     serverBuildDate: null,
                                                     serverMinPanelVersion: null,
                                                     serverVersionSource: null,
                                                 },
                                                 version: 0,
                                             })
    assert.equal(await secureStorage.setItem('cli-proxy-auth', persistedState, { persistent }), 'stored')
    assert.equal(await secureStorage.setItem('apiBase', apiBase, { persistent }), 'stored')
    assert.equal(await secureStorage.setItem('managementKey', managementKey, { persistent }), 'stored')
    if (persistent) {
        localStorage.setItem('isLoggedIn', 'true')
    }
    const source    = persistent ? localStorage : sessionStorage
    const snapshots = Object.fromEntries(
        ['cli-proxy-auth', 'apiBase', 'managementKey'].map((key) => [key, source.getItem(key)]),
    )
    return { secureStorage, snapshots }
}

async function loadAuthStore(fetchConfig: () => Promise<void> = async () => {
}): Promise<{
    useAuthStore: typeof import('../../src/stores/useAuthStore').useAuthStore
    useConfigStore: typeof import('../../src/stores/useConfigStore').useConfigStore
}> {
    const [{ useAuthStore }, { useConfigStore }] = await Promise.all([
                                                                         import('../../src/stores/useAuthStore'),
                                                                         import('../../src/stores/useConfigStore'),
                                                                     ])
    useConfigStore.setState({
                                fetchConfig: async () => {
                                    await fetchConfig()
                                    return {}
                                },
                            })
    await useAuthStore.persist.rehydrate()
    useAuthStore.setState({
                              refreshServerVersion: async () => {
                              },
                          })
    await delay()
    return { useAuthStore, useConfigStore }
}

async function assertUnreadableCiphertextIsPreserved(persistent: boolean): Promise<void> {
    const { snapshots } = await seedAuthentication(persistent, 'stored-key')
    const source        = persistent ? localStorage : sessionStorage
    const alternate     = persistent ? sessionStorage : localStorage
    let fetchCallCount  = 0
    installDecryptFailure()
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
    })

    assert.equal(await useAuthStore.getState().restoreSession(), false)
    assert.equal(fetchCallCount, 0)
    for (const [key, snapshot] of Object.entries(snapshots)) {
        assert.equal(source.getItem(key), snapshot)
        assert.equal(alternate.getItem(key), null)
    }
    assert.equal(localStorage.getItem('isLoggedIn'), persistent ? 'true' : null)
    const state = useAuthStore.getState()
    assert.equal(state.managementKey, '')
    assert.equal(state.storageRestoreFailed, true)
    assert.equal(state.storagePersistenceFailed, false)
    assert.equal(state.storageClearFailed, false)
    assert.equal(state.sessionRestoreStatus, 'failed')
}

async function runUnreadableBundleWithInvalidMetadataScenario(): Promise<void> {
    const { secureStorage } = await import('../../src/services/storage/secureStorage')
    const transactionId     = 'unreadable-bundle-transaction'
    localStorage.setItem('cli-proxy-auth:transaction', transactionId)
    assert.equal(await secureStorage.setItem('cli-proxy-auth:credentials', {
        version: 1,
        apiBase: 'https://example.test',
        managementKey: 'stored-key',
        transactionId,
    }, { persistent: true }), 'stored')
    const encryptedBundle = localStorage.getItem('cli-proxy-auth:credentials')
    assert.ok(encryptedBundle)
    localStorage.setItem('cli-proxy-auth', JSON.stringify('invalid metadata'))
    localStorage.setItem('isLoggedIn', 'true')
    installDecryptFailure()

    let fetchCallCount     = 0
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
    })
    assert.equal(await useAuthStore.getState().restoreSession(), false)
    assert.equal(fetchCallCount, 0)
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials'), encryptedBundle)
    assert.equal(localStorage.getItem('cli-proxy-auth'), null)
    assert.equal(localStorage.getItem('isLoggedIn'), 'true')
    assert.equal(useAuthStore.getState().storageRestoreFailed, true)
    assert.equal(useAuthStore.getState().storageClearFailed, false)
}

async function runSessionBarrierScenario(): Promise<void> {
    await seedAuthentication(false, 'stale-session-key')
    sessionStorage.setItem('cli-proxy-auth:invalidated', 'true')
    let fetchCallCount     = 0
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
    })

    assert.equal(await useAuthStore.getState().restoreSession(), false)
    assert.equal(fetchCallCount, 0)
    assert.equal(useAuthStore.getState().managementKey, '')
    assert.equal(useAuthStore.getState().isAuthenticated, false)
    for (const key of AUTH_STORAGE_KEYS) {
        assert.equal(sessionStorage.getItem(key), null)
    }
    assert.equal(sessionStorage.getItem('cli-proxy-auth:invalidated'), 'true')
    assert.equal(await useAuthStore.getState().restoreSession(), false)
    assert.equal([...cookies.keys()].some((name) => name.startsWith('cpam_auth_invalidated_')), false)
    assert.equal((historyState as Record<string, unknown> | null)?.__cpamAuthInvalidated, undefined)
}

async function runLocalBarrierPreservesSharedLoginScenario(): Promise<void> {
    const { secureStorage } = await import('../../src/services/storage/secureStorage')
    const transactionId     = 'current-shared-login'
    localStorage.setItem('cli-proxy-auth:transaction', transactionId)
    assert.equal(await secureStorage.setItem('cli-proxy-auth:credentials', {
        version: 1,
        apiBase: 'https://current.test',
        managementKey: 'current-key',
        transactionId,
    }, { persistent: true }), 'stored')
    localStorage.setItem('isLoggedIn', 'true')
    sessionStorage.setItem('cli-proxy-auth:invalidated', 'true')

    let fetchCallCount     = 0
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
    })
    assert.equal(await useAuthStore.getState().restoreSession(), false)
    assert.equal(fetchCallCount, 0)
    assert.equal(useAuthStore.getState().managementKey, '')
    assert.equal(sessionStorage.getItem('cli-proxy-auth:invalidated'), 'true')
    assert.equal(localStorage.getItem('cli-proxy-auth:transaction'), transactionId)
    assert.equal(localStorage.getItem('isLoggedIn'), 'true')
    const storedCredentials = await secureStorage.getItem<{
        managementKey: string
        transactionId: string
    }>('cli-proxy-auth:credentials', { persistent: true })
    assert.equal(storedCredentials?.managementKey, 'current-key')
    assert.equal(storedCredentials?.transactionId, transactionId)
}

async function runInvalidStateScenario(): Promise<void> {
    let fetchCallCount = 0
    await seedAuthentication(true, 'standalone-key', {
        apiBase: 'https://example.test',
        managementKey: { unexpected: 'value' },
        rememberPassword: true,
    })
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
    })

    assert.equal(await useAuthStore.getState().restoreSession(), false)
    assert.equal(fetchCallCount, 0)
    for (const key of AUTH_STORAGE_KEYS) {
        assert.equal(localStorage.getItem(key), null)
        assert.equal(sessionStorage.getItem(key), null)
    }
    assert.equal(localStorage.getItem('isLoggedIn'), null)
    assert.equal(useAuthStore.getState().hydrated, true)
    assert.equal(useAuthStore.getState().sessionRestoreStatus, 'failed')
}

async function runLegacyMigrationFailureScenario(): Promise<void> {
    const { secureStorage } = await import('../../src/services/storage/secureStorage')
    assert.equal(await secureStorage.setItem('managementKey', 'other-key'), 'stored')
    assert.equal(await secureStorage.setItem('apiBase', 'https://other.test'), 'stored')

    const legacyState = JSON.stringify({
                                           state: {
                                               apiBase: 'https://example.test',
                                               managementKey: 'legacy-key',
                                               rememberPassword: true,
                                           },
                                           version: 0,
                                       })
    localStorage.setItem('cli-proxy-auth', `plain::${JSON.stringify(legacyState)}`)
    localStorage.setItem('apiBase', `plain::${JSON.stringify('https://example.test')}`)
    localStorage.setItem('managementKey', `plain::${JSON.stringify('legacy-key')}`)
    localStorage.setItem('isLoggedIn', 'true')
    browserWindow.isSecureContext = false

    let fetchCallCount     = 0
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
    })
    assert.equal(await useAuthStore.getState().restoreSession(), false)
    assert.equal(fetchCallCount, 0)
    for (const key of AUTH_STORAGE_KEYS) {
        assert.equal(localStorage.getItem(key), null)
        assert.equal(sessionStorage.getItem(key), null)
    }
    assert.equal(localStorage.getItem('isLoggedIn'), null)
    assert.equal(useAuthStore.getState().sessionRestoreStatus, 'failed')
}

async function runEncodedPrefixKeyScenario(): Promise<void> {
    const managementKey = 'enc::v2::real-management-key'
    await seedAuthentication(true, managementKey)
    let fetchCallCount     = 0
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
    })

    assert.equal(await useAuthStore.getState().restoreSession(), true)
    assert.equal(fetchCallCount, 1)
    assert.equal(useAuthStore.getState().isAuthenticated, true)
    assert.equal(useAuthStore.getState().managementKey, managementKey)
}

async function runSameGenerationWriteScenario(): Promise<void> {
    const { secureStorage } = await import('../../src/services/storage/secureStorage')
    const { useAuthStore }  = await loadAuthStore()
    sessionStorage.clear()
    localStorage.clear()

    const originalCrypto = globalThis.crypto
    let releaseFirst     = () => {
    }
    let markStarted      = () => {
    }
    const firstStarted   = new Promise<void>((resolve) => {
        markStarted = resolve
    })
    const firstGate      = new Promise<void>((resolve) => {
        releaseFirst = resolve
    })
    let encryptCallCount = 0
    const subtle         = new Proxy(originalCrypto.subtle, {
        get: (target, property) => {
            const value = Reflect.get(target, property, target)
            if (property === 'encrypt') {
                return async (...args: Parameters<SubtleCrypto['encrypt']>) => {
                    ++encryptCallCount
                    if (encryptCallCount === 1) {
                        markStarted()
                        await firstGate
                    }
                    return Reflect.apply(value, target, args)
                }
            }
            return typeof value === 'function' ? value.bind(target) : value
        },
    })
    Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        writable: true,
        value: new Proxy(originalCrypto, {
            get: (target, property) => {
                if (property === 'subtle') {
                    return subtle
                }
                const value = Reflect.get(target, property, target)
                return typeof value === 'function' ? value.bind(target) : value
            },
        }),
    })

    const firstWrite = useAuthStore.setState({ serverVersion: 'stale-version' }) as unknown as Promise<void>
    await firstStarted
    const currentWrite = useAuthStore.setState({ serverVersion: 'current-version' }) as unknown as Promise<void>
    await currentWrite
    releaseFirst()
    await firstWrite

    const raw = await secureStorage.getItem<string>('cli-proxy-auth', {
        fallbackToPersistent: false,
    })
    assert.ok(raw)
    const persisted = JSON.parse(raw) as { state: { managementKey?: string; serverVersion: string } }
    assert.equal(persisted.state.serverVersion, 'current-version')
    assert.equal(persisted.state.managementKey, undefined)
}

async function runStaleLoginScenario(): Promise<void> {
    let rejectFirst: (error: Error) => void = (error) => {
        throw error
    }
    let startFirst                          = () => {
    }
    const firstStarted                      = new Promise<void>((resolve) => {
        startFirst = resolve
    })
    const firstRequest                      = new Promise<void>((_resolve, reject) => {
        rejectFirst = reject
    })
    let fetchCallCount                      = 0
    const { secureStorage }                 = await import('../../src/services/storage/secureStorage')
    const { useAuthStore }                  = await loadAuthStore(async () => {
        ++fetchCallCount
        if (fetchCallCount === 1) {
            startFirst()
            return firstRequest
        }
    })

    const staleLogin = useAuthStore.getState().login({
                                                         apiBase: 'https://stale.test',
                                                         managementKey: 'stale-key',
                                                         rememberPassword: true,
                                                     })
    await firstStarted
    await useAuthStore.getState().login({
                                            apiBase: 'https://current.test',
                                            managementKey: 'current-key',
                                            rememberPassword: true,
                                        })
    rejectFirst(Object.assign(new Error('stale unauthorized'), { status: 401 }))
    await assert.rejects(staleLogin)
    await delay()

    const state = useAuthStore.getState()
    assert.equal(state.isAuthenticated, true)
    assert.equal(state.managementKey, 'current-key')
    assert.equal(state.connectionStatus, 'connected')
    const storedCredentials = await secureStorage.getItem<{
        version: number
        apiBase: string
        managementKey: string
        transactionId: string
    }>('cli-proxy-auth:credentials', { persistent: true })
    assert.equal(storedCredentials?.version, 1)
    assert.equal(storedCredentials?.apiBase, 'https://current.test')
    assert.equal(storedCredentials?.managementKey, 'current-key')
    assert.ok(storedCredentials?.transactionId)
}

async function prepareAtomicCredentialWriteScenario(): Promise<ReloadPayload> {
    const { snapshots }    = await seedAuthentication(true, 'old-key')
    const storageError     = new Error('second login failed')
    let fetchCallCount     = 0
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
        if (fetchCallCount === 2) {
            throw storageError
        }
    })

    const originalCrypto = globalThis.crypto
    let releaseWrite     = () => {
    }
    let markWriteStarted = () => {
    }
    const writeStarted   = new Promise<void>((resolve) => {
        markWriteStarted = resolve
    })
    const writeGate      = new Promise<void>((resolve) => {
        releaseWrite = resolve
    })
    let encryptCallCount = 0
    const subtle         = new Proxy(originalCrypto.subtle, {
        get: (target, property) => {
            const value = Reflect.get(target, property, target)
            if (property === 'encrypt') {
                return async (...args: Parameters<SubtleCrypto['encrypt']>) => {
                    ++encryptCallCount
                    if (encryptCallCount === 1) {
                        markWriteStarted()
                        await writeGate
                    }
                    return Reflect.apply(value, target, args)
                }
            }
            return typeof value === 'function' ? value.bind(target) : value
        },
    })
    Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        writable: true,
        value: new Proxy(originalCrypto, {
            get: (target, property) => {
                if (property === 'subtle') {
                    return subtle
                }
                const value = Reflect.get(target, property, target)
                return typeof value === 'function' ? value.bind(target) : value
            },
        }),
    })

    const firstLogin = useAuthStore.getState().login({
                                                         apiBase: 'https://first.test',
                                                         managementKey: 'first-key',
                                                         rememberPassword: true,
                                                     })
    await writeStarted
    const secondLogin = useAuthStore.getState().login({
                                                          apiBase: 'https://second.test',
                                                          managementKey: 'second-key',
                                                          rememberPassword: true,
                                                      })
    releaseWrite()
    await assert.rejects(firstLogin, /superseded/)
    await assert.rejects(secondLogin, (error: unknown) => error === storageError)
    Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        writable: true,
        value: originalCrypto,
    })

    for (const key of ['apiBase', 'managementKey'] as const) {
        assert.equal(localStorage.getItem(key), snapshots[key], key)
    }
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials'), null)

    return {
        local: snapshotStorage(localStorageValue),
        session: snapshotStorage(sessionStorageValue),
        history: historyState,
        cookies: Object.fromEntries(cookies),
        host: browserWindow.location.host,
        port: browserWindow.location.port,
        protocol: browserWindow.location.protocol,
    }
}

async function runAtomicCredentialWriteReloadScenario(payload: ReloadPayload): Promise<void> {
    browserWindow.location.host     = payload.host
    browserWindow.location.port     = payload.port
    browserWindow.location.protocol = payload.protocol
    restoreStorage(localStorageValue, payload.local)
    restoreStorage(sessionStorageValue, payload.session)
    historyState = payload.history
    for (const [name, value] of Object.entries(payload.cookies)) {
        cookies.set(name, value)
    }

    let fetchCallCount      = 0
    const { secureStorage } = await import('../../src/services/storage/secureStorage')
    const { useAuthStore }  = await loadAuthStore(async () => {
        ++fetchCallCount
    })
    assert.equal(await useAuthStore.getState().restoreSession(), true)
    assert.equal(fetchCallCount, 1)
    assert.equal(useAuthStore.getState().apiBase, 'https://example.test')
    assert.equal(useAuthStore.getState().managementKey, 'old-key')
    const storedCredentials = await secureStorage.getItem<{
        version: number
        apiBase: string
        managementKey: string
        transactionId: string
    }>('cli-proxy-auth:credentials', { persistent: true })
    assert.equal(storedCredentials?.version, 1)
    assert.equal(storedCredentials?.apiBase, 'https://example.test')
    assert.equal(storedCredentials?.managementKey, 'old-key')
    assert.ok(storedCredentials?.transactionId)
}

async function prepareProtectedLoginFailureScenario(): Promise<ReloadPayload> {
    let loginError: Error | null           = null
    const { useAuthStore, useConfigStore } = await loadAuthStore(async () => {
        if (loginError) {
            throw loginError
        }
    })
    await useAuthStore.getState().login({
                                            apiBase: 'https://old.test',
                                            managementKey: 'old-key',
                                            rememberPassword: true,
                                        })
    const encryptedBundle = localStorage.getItem('cli-proxy-auth:credentials')
    const committedToken  = localStorage.getItem('cli-proxy-auth:transaction')
    assert.ok(encryptedBundle)
    assert.ok(committedToken)
    assert.equal(localStorage.getItem('cli-proxy-auth:intent'), committedToken)

    loginError = new Error('temporary network failure')
    useConfigStore.setState({
                                fetchConfig: async () => {
                                    throw loginError
                                },
                            })
    await assert.rejects(useAuthStore.getState().login({
                                                           apiBase: 'https://new.test',
                                                           managementKey: 'new-key',
                                                           rememberPassword: true,
                                                       }), (error: unknown) => error === loginError)

    assert.equal(localStorage.getItem('cli-proxy-auth:credentials'), encryptedBundle)
    assert.equal(localStorage.getItem('cli-proxy-auth:transaction'), committedToken)
    assert.equal(localStorage.getItem('cli-proxy-auth:intent'), committedToken)
    return {
        local: snapshotStorage(localStorageValue),
        session: snapshotStorage(sessionStorageValue),
        history: historyState,
        cookies: Object.fromEntries(cookies),
        host: browserWindow.location.host,
        port: browserWindow.location.port,
        protocol: browserWindow.location.protocol,
    }
}

async function runProtectedLoginFailureReloadScenario(payload: ReloadPayload): Promise<void> {
    browserWindow.location.host     = payload.host
    browserWindow.location.port     = payload.port
    browserWindow.location.protocol = payload.protocol
    restoreStorage(localStorageValue, payload.local)
    restoreStorage(sessionStorageValue, payload.session)
    historyState = payload.history
    for (const [name, value] of Object.entries(payload.cookies)) {
        cookies.set(name, value)
    }

    let fetchCallCount     = 0
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
    })
    assert.equal(await useAuthStore.getState().restoreSession(), true)
    assert.equal(fetchCallCount, 1)
    assert.equal(useAuthStore.getState().apiBase, 'https://old.test')
    assert.equal(useAuthStore.getState().managementKey, 'old-key')
}

async function prepareSessionLogoutReloadScenario(): Promise<ReloadPayload> {
    const { useAuthStore } = await loadAuthStore()
    await useAuthStore.getState().login({
                                            apiBase: 'https://session.test',
                                            managementKey: 'session-key',
                                            rememberPassword: false,
                                        })
    assert.equal(sessionStorage.getItem('cli-proxy-auth:credentials')?.startsWith('enc::v2::'), true)
    assert.ok(sessionStorage.getItem('cli-proxy-auth:transaction'))
    assert.ok(localStorage.getItem('cli-proxy-auth:intent'))
    localStorage.removeItem('cli-proxy-auth:intent')
    return {
        local: snapshotStorage(localStorageValue),
        session: snapshotStorage(sessionStorageValue),
        history: historyState,
        cookies: Object.fromEntries(cookies),
        host: browserWindow.location.host,
        port: browserWindow.location.port,
        protocol: browserWindow.location.protocol,
    }
}

async function runSessionLogoutReloadScenario(payload: ReloadPayload): Promise<void> {
    browserWindow.location.host     = payload.host
    browserWindow.location.port     = payload.port
    browserWindow.location.protocol = payload.protocol
    restoreStorage(localStorageValue, payload.local)
    restoreStorage(sessionStorageValue, payload.session)
    historyState = payload.history
    for (const [name, value] of Object.entries(payload.cookies)) {
        cookies.set(name, value)
    }
    const encryptedBundle = sessionStorage.getItem('cli-proxy-auth:credentials')

    let fetchCallCount     = 0
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
    })
    assert.equal(await useAuthStore.getState().restoreSession(), false)
    assert.equal(fetchCallCount, 0)
    assert.equal(useAuthStore.getState().managementKey, '')
    assert.equal(useAuthStore.getState().sessionRestoreStatus, 'skipped')
    assert.equal(sessionStorage.getItem('cli-proxy-auth:credentials'), encryptedBundle)
    assert.equal(localStorage.getItem('cli-proxy-auth:intent'), null)
}

async function runPendingCrossTabLoginBlocksRestoreScenario(): Promise<void> {
    const { secureStorage }      = await import('../../src/services/storage/secureStorage')
    const committedTransactionId = 'committed-before-pending-login'
    localStorage.setItem('cli-proxy-auth:intent', committedTransactionId)
    localStorage.setItem('cli-proxy-auth:transaction', committedTransactionId)
    assert.equal(await secureStorage.setItem('cli-proxy-auth:credentials', {
        version: 1,
        apiBase: 'https://committed.test',
        managementKey: 'committed-key',
        transactionId: committedTransactionId,
    }, { persistent: true }), 'stored')
    localStorage.setItem('isLoggedIn', 'true')
    localStorage.setItem('cli-proxy-auth:intent', 'pending-cross-tab-login')
    const encryptedBundle = localStorage.getItem('cli-proxy-auth:credentials')

    let fetchCallCount     = 0
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
    })
    assert.equal(await useAuthStore.getState().restoreSession(), false)
    assert.equal(fetchCallCount, 0)
    assert.equal(useAuthStore.getState().managementKey, '')
    assert.equal(useAuthStore.getState().sessionRestoreStatus, 'skipped')
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials'), encryptedBundle)
    assert.equal(localStorage.getItem('cli-proxy-auth:transaction'), committedTransactionId)
    assert.equal(localStorage.getItem('cli-proxy-auth:intent'), 'pending-cross-tab-login')
    assert.equal(localStorage.getItem('isLoggedIn'), 'true')
}

async function runCrossTabRestoreClaimScenario(): Promise<void> {
    const [{ secureStorage }, { encryptData }] = await Promise.all([
                                                                       import('../../src/services/storage/secureStorage'),
                                                                       import('../../src/utils/encryption'),
                                                                   ])
    const restoredTransactionId                = 'cross-tab-restored-login'
    localStorage.setItem('cli-proxy-auth:intent', restoredTransactionId)
    localStorage.setItem('cli-proxy-auth:transaction', restoredTransactionId)
    assert.equal(await secureStorage.setItem('cli-proxy-auth:credentials', {
        version: 1,
        apiBase: 'https://restored.test',
        managementKey: 'restored-key',
        transactionId: restoredTransactionId,
    }, { persistent: true }), 'stored')
    localStorage.setItem('isLoggedIn', 'true')

    let fetchCallCount                      = 0
    const { useAuthStore }                  = await loadAuthStore(async () => {
        ++fetchCallCount
    })
    const currentTransactionId              = 'cross-tab-current-restore'
    const currentCiphertext                 = await encryptData(JSON.stringify({
                                                                                   version: 1,
                                                                                   apiBase: 'https://current.test',
                                                                                   managementKey: 'current-key',
                                                                                   transactionId: currentTransactionId,
                                                                               }))
    const originalGetItem                   = localStorage.getItem
    const originalSetItem                   = localStorage.setItem
    let currentCommit: Promise<void> | null = null
    let injected                            = false
    localStorage.getItem                    = (key) => {
        const value = originalGetItem(key)
        if (key === 'cli-proxy-auth:credentials' && !injected) {
            injected      = true
            currentCommit = testLockManager.request(AUTH_STORAGE_TEST_LOCK_NAME, () => {
                originalSetItem('cli-proxy-auth:intent', currentTransactionId)
                originalSetItem('cli-proxy-auth:credentials', currentCiphertext)
                originalSetItem('cli-proxy-auth:transaction', currentTransactionId)
                originalSetItem('isLoggedIn', 'true')
            })
        }
        return value
    }

    try {
        assert.equal(await useAuthStore.getState().restoreSession(), false)
        assert.equal(injected, true)
        assert.ok(currentCommit)
        // noinspection ES6RedundantAwait
        await currentCommit
    } finally {
        localStorage.getItem = originalGetItem
    }

    assert.equal(fetchCallCount, 0)
    assert.equal(useAuthStore.getState().managementKey, '')
    assert.equal(localStorage.getItem('cli-proxy-auth:intent'), currentTransactionId)
    assert.equal(localStorage.getItem('cli-proxy-auth:transaction'), currentTransactionId)
    const storedCredentials = await secureStorage.getItem<{
        managementKey: string
        transactionId: string
    }>('cli-proxy-auth:credentials', { persistent: true })
    assert.equal(storedCredentials?.managementKey, 'current-key')
    assert.equal(storedCredentials?.transactionId, currentTransactionId)
}

async function runCrossTabDelayedLoginScenario(): Promise<void> {
    const [{ secureStorage }, { encryptData }] = await Promise.all([
                                                                       import('../../src/services/storage/secureStorage'),
                                                                       import('../../src/utils/encryption'),
                                                                   ])
    const { useAuthStore }                     = await loadAuthStore()
    const currentTransactionId                 = 'cross-tab-current-login'
    const currentCiphertext                    = await encryptData(JSON.stringify({
                                                                                      version: 1,
                                                                                      apiBase: 'https://current.test',
                                                                                      managementKey: 'current-key',
                                                                                      transactionId: currentTransactionId,
                                                                                  }))
    const originalSetItem                      = localStorage.setItem
    let currentCommit: Promise<void> | null    = null
    let injected                               = false
    localStorage.setItem                       = (key, value) => {
        if (key === 'cli-proxy-auth:credentials' && !injected) {
            injected      = true
            currentCommit = testLockManager.request(AUTH_STORAGE_TEST_LOCK_NAME, () => {
                originalSetItem('cli-proxy-auth:intent', currentTransactionId)
                originalSetItem('cli-proxy-auth:credentials', currentCiphertext)
                originalSetItem('cli-proxy-auth:transaction', currentTransactionId)
                originalSetItem('isLoggedIn', 'true')
            })
        }
        originalSetItem(key, value)
    }

    try {
        await useAuthStore.getState().login({
                                                apiBase: 'https://old.test',
                                                managementKey: 'old-key',
                                                rememberPassword: true,
                                            })
        assert.equal(injected, true)
        assert.ok(currentCommit)
        // noinspection ES6RedundantAwait
        await currentCommit
    } finally {
        localStorage.setItem = originalSetItem
    }

    assert.equal(localStorage.getItem('cli-proxy-auth:transaction'), currentTransactionId)
    const storedCredentials = await secureStorage.getItem<{
        apiBase: string
        managementKey: string
        transactionId: string
    }>('cli-proxy-auth:credentials', { persistent: true })
    assert.equal(storedCredentials?.apiBase, 'https://current.test')
    assert.equal(storedCredentials?.managementKey, 'current-key')
    assert.equal(storedCredentials?.transactionId, currentTransactionId)
}

async function runCrossTabStale401Scenario(): Promise<ReloadPayload> {
    const [{ secureStorage }, { encryptData }] = await Promise.all([
                                                                       import('../../src/services/storage/secureStorage'),
                                                                       import('../../src/utils/encryption'),
                                                                   ])
    const { useAuthStore }                     = await loadAuthStore()
    await useAuthStore.getState().login({
                                            apiBase: 'https://old.test',
                                            managementKey: 'old-key',
                                            rememberPassword: true,
                                        })

    const currentTransactionId              = 'cross-tab-current-401'
    const currentCiphertext                 = await encryptData(JSON.stringify({
                                                                                   version: 1,
                                                                                   apiBase: 'https://current.test',
                                                                                   managementKey: 'current-key',
                                                                                   transactionId: currentTransactionId,
                                                                               }))
    const originalGetItem                   = localStorage.getItem
    const originalSetItem                   = localStorage.setItem
    let currentCommit: Promise<void> | null = null
    let injected                            = false
    localStorage.getItem                    = (key) => {
        const value = originalGetItem(key)
        if (key === 'cli-proxy-auth:intent' && !injected) {
            injected      = true
            currentCommit = testLockManager.request(AUTH_STORAGE_TEST_LOCK_NAME, () => {
                originalSetItem('cli-proxy-auth:intent', currentTransactionId)
                originalSetItem('cli-proxy-auth:credentials', currentCiphertext)
                originalSetItem('cli-proxy-auth:transaction', currentTransactionId)
                originalSetItem('isLoggedIn', 'true')
            })
        }
        return value
    }

    try {
        browserWindow.dispatchEvent(new Event('unauthorized'))
        assert.equal(injected, true)
        assert.ok(currentCommit)
        // noinspection ES6RedundantAwait
        await currentCommit
        await delay()
    } finally {
        localStorage.getItem = originalGetItem
    }

    assert.equal(useAuthStore.getState().isAuthenticated, false)
    assert.equal(useAuthStore.getState().managementKey, '')
    assert.equal(localStorage.getItem('cli-proxy-auth:transaction'), currentTransactionId)
    assert.equal(localStorage.getItem('isLoggedIn'), 'true')
    const storedCredentials = await secureStorage.getItem<{
        apiBase: string
        managementKey: string
        transactionId: string
    }>('cli-proxy-auth:credentials', { persistent: true })
    assert.equal(storedCredentials?.apiBase, 'https://current.test')
    assert.equal(storedCredentials?.managementKey, 'current-key')
    assert.equal(storedCredentials?.transactionId, currentTransactionId)
    assert.equal(sessionStorage.getItem('cli-proxy-auth:invalidated'), null)
    return {
        local: snapshotStorage(localStorageValue),
        session: snapshotStorage(sessionStorageValue),
        history: historyState,
        cookies: Object.fromEntries(cookies),
        host: browserWindow.location.host,
        port: browserWindow.location.port,
        protocol: browserWindow.location.protocol,
    }
}

async function runCrossTabStale401ReloadScenario(payload: ReloadPayload): Promise<void> {
    browserWindow.location.host     = payload.host
    browserWindow.location.port     = payload.port
    browserWindow.location.protocol = payload.protocol
    restoreStorage(localStorageValue, payload.local)
    restoreStorage(sessionStorageValue, payload.session)
    historyState = payload.history
    for (const [name, value] of Object.entries(payload.cookies)) {
        cookies.set(name, value)
    }

    let fetchCallCount      = 0
    const { secureStorage } = await import('../../src/services/storage/secureStorage')
    const { useAuthStore }  = await loadAuthStore(async () => {
        ++fetchCallCount
    })
    assert.equal(await useAuthStore.getState().restoreSession(), true)
    assert.equal(fetchCallCount, 1)
    assert.equal(useAuthStore.getState().managementKey, 'current-key')
    assert.equal(sessionStorage.getItem('cli-proxy-auth:invalidated'), null)
    const committedTransaction = localStorage.getItem('cli-proxy-auth:transaction')
    assert.ok(committedTransaction)
    const storedCredentials = await secureStorage.getItem<{
        managementKey: string
        transactionId: string
    }>('cli-proxy-auth:credentials', { persistent: true })
    assert.equal(storedCredentials?.managementKey, 'current-key')
    assert.equal(storedCredentials?.transactionId, committedTransaction)
}

async function runCrossTabLogoutOrderingScenario(): Promise<void> {
    const [{ secureStorage }, { encryptData }] = await Promise.all([
                                                                       import('../../src/services/storage/secureStorage'),
                                                                       import('../../src/utils/encryption'),
                                                                   ])
    const { useAuthStore }                     = await loadAuthStore()
    await useAuthStore.getState().login({
                                            apiBase: 'https://old.test',
                                            managementKey: 'old-key',
                                            rememberPassword: true,
                                        })

    const currentTransactionId              = 'cross-tab-current-after-logout'
    const currentCiphertext                 = await encryptData(JSON.stringify({
                                                                                   version: 1,
                                                                                   apiBase: 'https://current.test',
                                                                                   managementKey: 'current-key',
                                                                                   transactionId: currentTransactionId,
                                                                               }))
    const originalRemoveItem                = localStorage.removeItem
    const originalSetItem                   = localStorage.setItem
    let currentCommit: Promise<void> | null = null
    let injected                            = false
    localStorage.removeItem                 = (key) => {
        if (key === 'cli-proxy-auth:credentials' && !injected) {
            injected      = true
            currentCommit = testLockManager.request(AUTH_STORAGE_TEST_LOCK_NAME, () => {
                originalSetItem('cli-proxy-auth:intent', currentTransactionId)
                originalSetItem('cli-proxy-auth:credentials', currentCiphertext)
                originalSetItem('cli-proxy-auth:transaction', currentTransactionId)
                originalSetItem('isLoggedIn', 'true')
            })
        }
        originalRemoveItem(key)
    }

    try {
        useAuthStore.getState().logout()
        assert.equal(injected, true)
        assert.ok(currentCommit)
        // noinspection ES6RedundantAwait
        await currentCommit
        await delay()
    } finally {
        localStorage.removeItem = originalRemoveItem
    }

    assert.equal(useAuthStore.getState().isAuthenticated, false)
    assert.equal(useAuthStore.getState().managementKey, '')
    assert.equal(localStorage.getItem('cli-proxy-auth:intent'), currentTransactionId)
    assert.equal(localStorage.getItem('cli-proxy-auth:transaction'), currentTransactionId)
    assert.equal(localStorage.getItem('isLoggedIn'), 'true')
    const storedCredentials = await secureStorage.getItem<{
        managementKey: string
        transactionId: string
    }>('cli-proxy-auth:credentials', { persistent: true })
    assert.equal(storedCredentials?.managementKey, 'current-key')
    assert.equal(storedCredentials?.transactionId, currentTransactionId)
}

async function runCrossTabPendingLoginStale401Scenario(): Promise<void> {
    const { useAuthStore } = await loadAuthStore()
    await useAuthStore.getState().login({
                                            apiBase: 'https://old.test',
                                            managementKey: 'old-key',
                                            rememberPassword: true,
                                        })
    const committedTransaction = localStorage.getItem('cli-proxy-auth:transaction')
    assert.ok(committedTransaction)
    localStorage.setItem('cli-proxy-auth:intent', 'pending-cross-tab-login')

    browserWindow.dispatchEvent(new Event('unauthorized'))
    await delay()

    assert.equal(useAuthStore.getState().isAuthenticated, false)
    assert.equal(useAuthStore.getState().managementKey, '')
    assert.equal(localStorage.getItem('cli-proxy-auth:intent'), 'pending-cross-tab-login')
    assert.equal(localStorage.getItem('cli-proxy-auth:transaction'), null)
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials'), null)
    assert.equal(localStorage.getItem('isLoggedIn'), null)
    assert.equal(sessionStorage.getItem('cli-proxy-auth:invalidated'), 'true')
}

async function runCrossTabMemoryOnlyStale401Scenario(): Promise<void> {
    browserWindow.isSecureContext = false
    const { secureStorage }       = await import('../../src/services/storage/secureStorage')
    const { useAuthStore }        = await loadAuthStore()
    await useAuthStore.getState().login({
                                            apiBase: 'https://memory.test',
                                            managementKey: 'memory-key',
                                            rememberPassword: true,
                                        })
    assert.equal(useAuthStore.getState().storagePersistenceFailed, true)

    browserWindow.isSecureContext = true
    const currentTransactionId    = 'cross-tab-current-after-memory-only'
    localStorage.setItem('cli-proxy-auth:intent', currentTransactionId)
    assert.equal(await secureStorage.setItem('cli-proxy-auth:credentials', {
        version: 1,
        apiBase: 'https://current.test',
        managementKey: 'current-key',
        transactionId: currentTransactionId,
    }, { persistent: true }), 'stored')
    localStorage.setItem('cli-proxy-auth:transaction', currentTransactionId)
    localStorage.setItem('isLoggedIn', 'true')

    browserWindow.dispatchEvent(new Event('unauthorized'))
    await delay()

    assert.equal(useAuthStore.getState().isAuthenticated, false)
    assert.equal(useAuthStore.getState().managementKey, '')
    assert.equal(localStorage.getItem('cli-proxy-auth:intent'), currentTransactionId)
    assert.equal(localStorage.getItem('cli-proxy-auth:transaction'), currentTransactionId)
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials')?.startsWith('enc::v2::'), true)
    assert.equal(localStorage.getItem('isLoggedIn'), 'true')
    assert.equal(sessionStorage.getItem('cli-proxy-auth:invalidated'), 'true')
}

async function runStaleAuthBlobScenario(): Promise<void> {
    const { secureStorage } = await seedAuthentication(true, 'old-key')
    const transactionId     = 'current-bundle-transaction'
    localStorage.setItem('cli-proxy-auth:intent', transactionId)
    localStorage.setItem('cli-proxy-auth:transaction', transactionId)
    assert.equal(await secureStorage.setItem('cli-proxy-auth:credentials', {
        version: 1,
        apiBase: 'https://current.test',
        managementKey: 'current-key',
        transactionId,
    }, { persistent: true }), 'stored')

    let fetchCallCount     = 0
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
    })
    assert.equal(await useAuthStore.getState().restoreSession(), true)
    assert.equal(fetchCallCount, 1)
    assert.equal(useAuthStore.getState().apiBase, 'https://current.test')
    assert.equal(useAuthStore.getState().managementKey, 'current-key')
    assert.equal(localStorage.getItem('apiBase'), null)
    assert.equal(localStorage.getItem('managementKey'), null)
    await delay()
    const metadata = await secureStorage.getItem<string>('cli-proxy-auth', { persistent: true })
    assert.ok(metadata)
    const persistedState = JSON.parse(metadata) as { state: { apiBase?: string; managementKey?: string } }
    assert.equal(persistedState.state.apiBase, undefined)
    assert.equal(persistedState.state.managementKey, undefined)
}

async function runMismatchedLegacySourcesScenario(): Promise<void> {
    const { secureStorage } = await seedAuthentication(true, 'old-key')
    assert.equal(await secureStorage.setItem('apiBase', 'https://current.test', { persistent: true }), 'stored')
    assert.equal(await secureStorage.setItem('managementKey', 'current-key', { persistent: true }), 'stored')

    let fetchCallCount     = 0
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
    })
    assert.equal(await useAuthStore.getState().restoreSession(), false)
    assert.equal(fetchCallCount, 0)
    assert.equal(useAuthStore.getState().managementKey, '')
    assert.equal(useAuthStore.getState().storageRestoreFailed, true)
    assert.equal(localStorage.getItem('isLoggedIn'), null)
    for (const key of AUTH_STORAGE_KEYS) {
        assert.equal(localStorage.getItem(key), null)
    }
}

async function runCurrentLogin401Scenario(): Promise<void> {
    const unauthorized     = Object.assign(new Error('unauthorized'), { status: 401 })
    const { useAuthStore } = await loadAuthStore(async () => {
        browserWindow.dispatchEvent(new Event('unauthorized'))
        throw unauthorized
    })

    await assert.rejects(
        useAuthStore.getState().login({
                                          apiBase: 'https://example.test',
                                          managementKey: 'expired-key',
                                          rememberPassword: true,
                                      }),
        (error: unknown) => error === unauthorized,
    )
    const state = useAuthStore.getState()
    assert.equal(state.isAuthenticated, false)
    assert.equal(state.managementKey, '')
    assert.equal(state.connectionStatus, 'error')
    assert.equal(state.connectionError, 'Management key is invalid or expired')
    assert.equal(state.sessionRestoreStatus, 'failed')
    assert.equal(await state.restoreSession(), false)
    for (const key of AUTH_STORAGE_KEYS) {
        assert.equal(localStorage.getItem(key), null)
        assert.equal(sessionStorage.getItem(key), null)
    }
}

async function runMemoryOnlySuccessfulRetryScenario(): Promise<void> {
    browserWindow.isSecureContext = false
    const { secureStorage }       = await import('../../src/services/storage/secureStorage')
    const { useAuthStore }        = await loadAuthStore()
    await useAuthStore.getState().login({
                                            apiBase: 'https://memory.test',
                                            managementKey: 'memory-key',
                                            rememberPassword: true,
                                        })
    assert.equal(useAuthStore.getState().storagePersistenceFailed, true)

    browserWindow.isSecureContext = true
    const originalCrypto          = globalThis.crypto
    let releaseWrites             = () => {
    }
    let markWritesStarted         = () => {
    }
    const writesStarted           = new Promise<void>((resolve) => {
        markWritesStarted = resolve
    })
    const writeGate               = new Promise<void>((resolve) => {
        releaseWrites = resolve
    })
    let encryptCallCount          = 0
    const subtle                  = new Proxy(originalCrypto.subtle, {
        get: (target, property) => {
            const value = Reflect.get(target, property, target)
            if (property === 'encrypt') {
                return async (...args: Parameters<SubtleCrypto['encrypt']>) => {
                    ++encryptCallCount
                    if (encryptCallCount === 1) {
                        markWritesStarted()
                        await writeGate
                    }
                    return Reflect.apply(value, target, args)
                }
            }
            return typeof value === 'function' ? value.bind(target) : value
        },
    })
    Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        writable: true,
        value: new Proxy(originalCrypto, {
            get: (target, property) => {
                if (property === 'subtle') {
                    return subtle
                }
                const value = Reflect.get(target, property, target)
                return typeof value === 'function' ? value.bind(target) : value
            },
        }),
    })

    const retry = useAuthStore.getState().login({
                                                    apiBase: 'https://retry.test',
                                                    managementKey: 'current-key',
                                                    rememberPassword: false,
                                                })
    await writesStarted
    useAuthStore.setState({ serverVersion: 'interleaving-update' })
    await delay()
    assert.equal(localStorage.getItem('cli-proxy-auth'), null)
    assert.equal(sessionStorage.getItem('cli-proxy-auth'), null)
    assert.equal(sessionStorage.getItem('cli-proxy-auth:credentials'), null)
    assert.equal(sessionStorage.getItem('managementKey'), null)

    releaseWrites()
    await retry
    await delay()
    const authRaw = await secureStorage.getItem<string>('cli-proxy-auth', {
        fallbackToPersistent: false,
    })
    assert.ok(authRaw)
    const authState = JSON.parse(authRaw) as { state: { managementKey?: string } }
    assert.equal(authState.state.managementKey, undefined)
    const storedCredentials = await secureStorage.getItem<{
        version: number
        apiBase: string
        managementKey: string
        transactionId: string
    }>('cli-proxy-auth:credentials', { fallbackToPersistent: false })
    assert.equal(storedCredentials?.version, 1)
    assert.equal(storedCredentials?.apiBase, 'https://retry.test')
    assert.equal(storedCredentials?.managementKey, 'current-key')
    assert.ok(storedCredentials?.transactionId)
    assert.equal(await secureStorage.getItem('managementKey', { fallbackToPersistent: false }), null)
}

async function runMemoryOnlyRetryScenario(): Promise<void> {
    browserWindow.isSecureContext          = false
    let nextError: Error | null            = null
    const { useAuthStore, useConfigStore } = await loadAuthStore(async () => {
        if (nextError) {
            throw nextError
        }
    })
    await useAuthStore.getState().login({
                                            apiBase: 'https://memory.test',
                                            managementKey: 'memory-key',
                                            rememberPassword: true,
                                        })
    assert.equal(useAuthStore.getState().storagePersistenceFailed, true)

    browserWindow.isSecureContext = true
    nextError                     = new Error('temporary network failure')
    useConfigStore.setState({
                                fetchConfig: async () => {
                                    throw nextError
                                },
                            })
    await assert.rejects(useAuthStore.getState().login({
                                                           apiBase: 'https://retry.test',
                                                           managementKey: 'retry-key',
                                                           rememberPassword: false,
                                                       }))
    await delay()

    for (const key of ['cli-proxy-auth', 'cli-proxy-auth:credentials', 'apiBase', 'managementKey']) {
        assert.equal(localStorage.getItem(key), null)
        assert.equal(sessionStorage.getItem(key), null)
    }
    assert.equal(localStorage.getItem('cli-proxy-auth:intent'), null)
    assert.equal(sessionStorage.getItem('cli-proxy-auth:intent'), null)
    assert.equal(localStorage.getItem('cli-proxy-auth:transaction'), null)
    assert.equal(sessionStorage.getItem('cli-proxy-auth:transaction'), null)
    assert.equal(localStorage.getItem('isLoggedIn'), null)
}

async function runRememberSwitchScenario(): Promise<void> {
    const { secureStorage } = await import('../../src/services/storage/secureStorage')
    const { useAuthStore }  = await loadAuthStore()
    await useAuthStore.getState().login({
                                            apiBase: 'https://example.test',
                                            managementKey: 'remembered-key',
                                            rememberPassword: true,
                                        })
    await delay()
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials')?.startsWith('enc::v2::'), true)
    assert.equal(sessionStorage.getItem('cli-proxy-auth:credentials'), null)
    assert.equal(localStorage.getItem('managementKey'), null)
    assert.equal(localStorage.getItem('isLoggedIn'), 'true')

    await useAuthStore.getState().login({
                                            apiBase: 'https://example.test',
                                            managementKey: 'session-key',
                                            rememberPassword: false,
                                        })
    await delay()
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials'), null)
    assert.equal(localStorage.getItem('cli-proxy-auth'), null)
    assert.equal(localStorage.getItem('isLoggedIn'), null)
    assert.equal(sessionStorage.getItem('cli-proxy-auth:credentials')?.startsWith('enc::v2::'), true)
    const storedCredentials = await secureStorage.getItem<{
        version: number
        apiBase: string
        managementKey: string
        transactionId: string
    }>('cli-proxy-auth:credentials', { fallbackToPersistent: false })
    assert.equal(storedCredentials?.version, 1)
    assert.equal(storedCredentials?.apiBase, 'https://example.test')
    assert.equal(storedCredentials?.managementKey, 'session-key')
    assert.ok(storedCredentials?.transactionId)
}

async function runTombstoneScenario(): Promise<void> {
    await seedAuthentication(true, 'stored-key')
    const { useAuthStore } = await loadAuthStore()
    assert.equal(await useAuthStore.getState().restoreSession(), true)
    const originalRemove    = localStorage.removeItem
    localStorage.removeItem = () => {
        throw new Error('remove unavailable')
    }

    browserWindow.dispatchEvent(new Event('unauthorized'))
    await delay()
    for (const key of AUTH_STORAGE_KEYS) {
        assert.equal(localStorage.getItem(key), 'invalidated::')
    }
    assert.equal(localStorage.getItem('isLoggedIn'), 'false')
    assert.equal(useAuthStore.getState().storageClearFailed, false)
    assert.equal(useAuthStore.getState().managementKey, '')
    assert.equal(await useAuthStore.getState().restoreSession(), false)
    localStorage.removeItem = originalRemove
}

async function runClearFailureScenario(): Promise<void> {
    await seedAuthentication(true, 'stored-key')
    const { useAuthStore } = await loadAuthStore()
    assert.equal(await useAuthStore.getState().restoreSession(), true)
    const localRemove         = localStorage.removeItem
    const localSet            = localStorage.setItem
    const sessionRemove       = sessionStorage.removeItem
    const sessionSet          = sessionStorage.setItem
    localStorage.removeItem   = () => {
        throw new Error('remove unavailable')
    }
    localStorage.setItem      = () => {
        throw new Error('write unavailable')
    }
    sessionStorage.removeItem = () => {
        throw new Error('remove unavailable')
    }
    sessionStorage.setItem    = () => {
        throw new Error('write unavailable')
    }

    browserWindow.dispatchEvent(new Event('unauthorized'))
    await delay()
    const state = useAuthStore.getState()
    assert.equal(state.isAuthenticated, false)
    assert.equal(state.managementKey, '')
    assert.equal(state.connectionStatus, 'error')
    assert.equal(state.storagePersistenceFailed, true)
    assert.equal(state.storageClearFailed, true)
    assert.equal(state.sessionRestoreStatus, 'failed')
    assert.equal(await state.restoreSession(), false)

    localStorage.removeItem   = localRemove
    localStorage.setItem      = localSet
    sessionStorage.removeItem = sessionRemove
    sessionStorage.setItem    = sessionSet
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials')?.startsWith('enc::v2::'), true)
}

async function prepareTotalDenialReloadScenario(): Promise<ReloadPayload> {
    browserWindow.location.host = 'secure-storage.test:5173'
    browserWindow.location.port = '5173'
    await seedAuthentication(true, 'expired-key')
    const { useAuthStore } = await loadAuthStore()
    assert.equal(await useAuthStore.getState().restoreSession(), true)

    for (const name of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(globalThis, name, {
            configurable: true,
            get: () => {
                throw new DOMException('storage unavailable', 'SecurityError')
            },
        })
    }
    browserWindow.dispatchEvent(new Event('unauthorized'))
    await delay()
    assert.equal(useAuthStore.getState().storageClearFailed, true)
    assert.equal((historyState as Record<string, unknown>).__cpamAuthInvalidated, true)
    assert.equal(
        [...cookies].some(([name, value]) => name.startsWith('cpam_auth_invalidated_') && value === '1'),
        true,
    )

    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: localStorageValue,
    })
    Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        writable: true,
        value: sessionStorageValue,
    })
    return {
        local: snapshotStorage(localStorageValue),
        session: snapshotStorage(sessionStorageValue),
        history: historyState,
        cookies: Object.fromEntries(cookies),
        host: browserWindow.location.host,
        port: browserWindow.location.port,
        protocol: browserWindow.location.protocol,
    }
}

async function runTotalDenialReloadScenario(payload: ReloadPayload): Promise<void> {
    browserWindow.location.host     = payload.host
    browserWindow.location.port     = payload.port
    browserWindow.location.protocol = payload.protocol
    restoreStorage(localStorageValue, payload.local)
    restoreStorage(sessionStorageValue, payload.session)
    historyState = null
    cookies.clear()
    for (const [name, value] of Object.entries(payload.cookies)) {
        cookies.set(name, value)
    }
    assert.equal(localStorage.getItem('isLoggedIn'), 'true')
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials')?.startsWith('enc::v2::'), true)
    assert.equal(sessionStorage.getItem('cli-proxy-auth:invalidated'), null)
    assert.equal(
        [...cookies].some(([name, value]) => name.startsWith('cpam_auth_invalidated_') && value === '1'),
        true,
    )

    let fetchCallCount                           = 0
    const [{ useAuthStore }, { useConfigStore }] = await Promise.all([
                                                                         import('../../src/stores/useAuthStore'),
                                                                         import('../../src/stores/useConfigStore'),
                                                                     ])
    useConfigStore.setState({
                                fetchConfig: async () => {
                                    ++fetchCallCount
                                    return {}
                                },
                            })
    await useAuthStore.persist.rehydrate()
    assert.equal(await useAuthStore.getState().restoreSession(), false)
    assert.equal(fetchCallCount, 0)
    assert.equal(useAuthStore.getState().managementKey, '')
    assert.equal(useAuthStore.getState().isAuthenticated, false)
}

async function runOtherPortCookieScenario(payload: ReloadPayload): Promise<void> {
    browserWindow.location.host = 'secure-storage.test:8317'
    browserWindow.location.port = '8317'
    historyState                = null
    cookies.clear()
    for (const [name, value] of Object.entries(payload.cookies)) {
        cookies.set(name, value)
    }
    assert.equal(
        [...cookies].some(([name, value]) => name.startsWith('cpam_auth_invalidated_') && value === '1'),
        true,
    )

    await seedAuthentication(true, 'other-port-key')
    let fetchCallCount     = 0
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
    })
    assert.equal(await useAuthStore.getState().restoreSession(), true)
    assert.equal(fetchCallCount, 1)
    assert.equal(useAuthStore.getState().managementKey, 'other-port-key')
    assert.equal(useAuthStore.getState().isAuthenticated, true)
}

async function runLockRequestFailureScenario(): Promise<void> {
    const { secureStorage } = await import('../../src/services/storage/secureStorage')
    const transactionId     = 'stored-before-lock-failure'
    localStorage.setItem('cli-proxy-auth:intent', transactionId)
    localStorage.setItem('cli-proxy-auth:transaction', transactionId)
    assert.equal(await secureStorage.setItem('cli-proxy-auth:credentials', {
        version: 1,
        apiBase: 'https://stored.test',
        managementKey: 'stored-key',
        transactionId,
    }, { persistent: true }), 'stored')
    localStorage.setItem('isLoggedIn', 'true')
    const encryptedBundle = localStorage.getItem('cli-proxy-auth:credentials')
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {
            request: async () => {
                throw new Error('lock request failed')
            },
        },
    })

    const { useAuthStore } = await loadAuthStore()
    await useAuthStore.getState().login({
                                            apiBase: 'https://memory.test',
                                            managementKey: 'memory-key',
                                            rememberPassword: true,
                                        })

    const state = useAuthStore.getState()
    assert.equal(state.isAuthenticated, true)
    assert.equal(state.managementKey, 'memory-key')
    assert.equal(state.rememberPassword, false)
    assert.equal(state.storagePersistenceFailed, true)
    assert.equal(state.storageClearFailed, true)
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials'), encryptedBundle)
    assert.equal(localStorage.getItem('cli-proxy-auth:intent'), transactionId)
    assert.equal(localStorage.getItem('cli-proxy-auth:transaction'), transactionId)
    assert.equal(localStorage.getItem('isLoggedIn'), 'true')
    assert.equal(sessionStorage.getItem('cli-proxy-auth:invalidated'), 'true')
    assert.equal(
        [...cookies].some(([name, value]) => name.startsWith('cpam_auth_invalidated_') && value === '1'),
        true,
    )
    assert.equal(Object.values(snapshotStorage(localStorage)).some((value) => value.includes('plain::')), false)
}

async function runLockUnavailableScenario(): Promise<void> {
    Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: undefined,
    })
    const { isSecureStorageProtected } = await import('../../src/services/storage/secureStorage')
    assert.equal(isSecureStorageProtected(), false)
    let fetchCallCount     = 0
    const { useAuthStore } = await loadAuthStore(async () => {
        ++fetchCallCount
    })
    assert.equal(await useAuthStore.getState().restoreSession(), false)
    assert.equal(fetchCallCount, 0)
    assert.equal(useAuthStore.getState().storageRestoreFailed, false)
    assert.equal(useAuthStore.getState().sessionRestoreStatus, 'skipped')
    await useAuthStore.getState().login({
                                            apiBase: 'https://memory.test',
                                            managementKey: 'memory-key',
                                            rememberPassword: true,
                                        })

    const state = useAuthStore.getState()
    assert.equal(state.isAuthenticated, true)
    assert.equal(state.managementKey, 'memory-key')
    assert.equal(state.rememberPassword, false)
    assert.equal(state.storagePersistenceFailed, true)
    for (const storage of [localStorage, sessionStorage]) {
        for (const key of [
            'cli-proxy-auth:credentials',
            'cli-proxy-auth:intent',
            'cli-proxy-auth:transaction',
            'apiBase',
            'apiUrl',
            'managementKey',
        ]) {
            assert.equal(storage.getItem(key), null)
        }
        assert.equal(Object.values(snapshotStorage(storage)).some((value) => value.includes('plain::')), false)
    }
    assert.equal(localStorage.getItem('isLoggedIn'), null)
}

async function runTransientDenialReloadScenario(): Promise<void> {
    await seedAuthentication(true, 'expired-key')
    const { useAuthStore, useConfigStore } = await loadAuthStore()
    assert.equal(await useAuthStore.getState().restoreSession(), true)

    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get: () => {
            throw new DOMException('storage unavailable', 'SecurityError')
        },
    })
    browserWindow.dispatchEvent(new Event('unauthorized'))
    await delay()
    assert.equal(useAuthStore.getState().storageClearFailed, true)
    assert.equal(sessionStorage.getItem('cli-proxy-auth:invalidated'), 'true')

    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: localStorageValue,
    })
    assert.equal(localStorage.getItem('isLoggedIn'), 'true')
    assert.equal(localStorage.getItem('cli-proxy-auth:credentials')?.startsWith('enc::v2::'), true)

    let fetchCallCount = 0
    useConfigStore.setState({
                                fetchConfig: async () => {
                                    ++fetchCallCount
                                    return {}
                                },
                            })
    const freshModuleUrl = new URL('../../src/stores/useAuthStore.ts', import.meta.url)
    freshModuleUrl.searchParams.set('reload', 'transient-denial')
    const { useAuthStore: freshAuthStore } = await import(freshModuleUrl.href)
    await freshAuthStore.persist.rehydrate()

    assert.equal(await freshAuthStore.getState().restoreSession(), false)
    assert.equal(fetchCallCount, 0)
    assert.equal(freshAuthStore.getState().managementKey, '')
    assert.equal(freshAuthStore.getState().isAuthenticated, false)
    assert.equal(sessionStorage.getItem('cli-proxy-auth:invalidated'), 'true')
}

const scenario = process.argv[2]
let output     = `secure-storage-auth-recovery:${scenario}=PASS`
switch (scenario) {
    case 'persistent-unreadable':
        await assertUnreadableCiphertextIsPreserved(true)
        break
    case 'session-unreadable':
        await assertUnreadableCiphertextIsPreserved(false)
        break
    case 'unreadable-bundle-invalid-metadata':
        await runUnreadableBundleWithInvalidMetadataScenario()
        break
    case 'session-barrier':
        await runSessionBarrierScenario()
        break
    case 'local-barrier-preserves-shared-login':
        await runLocalBarrierPreservesSharedLoginScenario()
        break
    case 'invalid-state':
        await runInvalidStateScenario()
        break
    case 'legacy-migration-failure':
        await runLegacyMigrationFailureScenario()
        break
    case 'encoded-prefix-key':
        await runEncodedPrefixKeyScenario()
        break
    case 'same-generation-write':
        await runSameGenerationWriteScenario()
        break
    case 'stale-login':
        await runStaleLoginScenario()
        break
    case 'prepare-protected-login-failure':
        output = JSON.stringify(await prepareProtectedLoginFailureScenario())
        break
    case 'protected-login-failure-reload': {
        const encoded = process.argv[3]
        assert.ok(encoded)
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ReloadPayload
        await runProtectedLoginFailureReloadScenario(payload)
        break
    }
    case 'prepare-atomic-credential-write':
        output = JSON.stringify(await prepareAtomicCredentialWriteScenario())
        break
    case 'atomic-credential-write-reload': {
        const encoded = process.argv[3]
        assert.ok(encoded)
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ReloadPayload
        await runAtomicCredentialWriteReloadScenario(payload)
        break
    }
    case 'prepare-session-logout-reload':
        output = JSON.stringify(await prepareSessionLogoutReloadScenario())
        break
    case 'session-logout-reload': {
        const encoded = process.argv[3]
        assert.ok(encoded)
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ReloadPayload
        await runSessionLogoutReloadScenario(payload)
        break
    }
    case 'pending-cross-tab-login-blocks-restore':
        await runPendingCrossTabLoginBlocksRestoreScenario()
        break
    case 'cross-tab-restore-claim':
        await runCrossTabRestoreClaimScenario()
        break
    case 'cross-tab-delayed-login':
        await runCrossTabDelayedLoginScenario()
        break
    case 'cross-tab-stale-401':
        await runCrossTabStale401Scenario()
        break
    case 'prepare-cross-tab-stale-401-reload':
        output = JSON.stringify(await runCrossTabStale401Scenario())
        break
    case 'cross-tab-stale-401-reload': {
        const encoded = process.argv[3]
        assert.ok(encoded)
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ReloadPayload
        await runCrossTabStale401ReloadScenario(payload)
        break
    }
    case 'cross-tab-logout-ordering':
        await runCrossTabLogoutOrderingScenario()
        break
    case 'cross-tab-pending-login-stale-401':
        await runCrossTabPendingLoginStale401Scenario()
        break
    case 'cross-tab-memory-only-stale-401':
        await runCrossTabMemoryOnlyStale401Scenario()
        break
    case 'stale-auth-blob':
        await runStaleAuthBlobScenario()
        break
    case 'mismatched-legacy-sources':
        await runMismatchedLegacySourcesScenario()
        break
    case 'current-login-401':
        await runCurrentLogin401Scenario()
        break
    case 'memory-only-successful-retry':
        await runMemoryOnlySuccessfulRetryScenario()
        break
    case 'memory-only-retry':
        await runMemoryOnlyRetryScenario()
        break
    case 'remember-switch':
        await runRememberSwitchScenario()
        break
    case 'tombstone':
        await runTombstoneScenario()
        break
    case 'clear-failure':
        await runClearFailureScenario()
        break
    case 'lock-request-failure':
        await runLockRequestFailureScenario()
        break
    case 'lock-unavailable':
        await runLockUnavailableScenario()
        break
    case 'transient-denial-reload':
        await runTransientDenialReloadScenario()
        break
    case 'prepare-total-denial-reload':
        output = JSON.stringify(await prepareTotalDenialReloadScenario())
        break
    case 'total-denial-reload': {
        const encoded = process.argv[3]
        assert.ok(encoded)
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ReloadPayload
        await runTotalDenialReloadScenario(payload)
        break
    }
    case 'other-port-cookie': {
        const encoded = process.argv[3]
        assert.ok(encoded)
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ReloadPayload
        await runOtherPortCookieScenario(payload)
        break
    }
    default:
        throw new Error(`Unknown secure storage auth scenario: ${scenario || '<missing>'}`)
}

console.log(output)
