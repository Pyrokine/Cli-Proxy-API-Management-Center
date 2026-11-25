export function createMemoryStorage(): Storage {
    const values = new Map<string, string>()
    return {
        get length() {
            return values.size
        },
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => [...values.keys()][index] ?? null,
        removeItem: (key: string) => values.delete(key),
        setItem: (key: string, value: string) => values.set(key, value),
    }
}

export type MemoryStorageWindow = EventTarget & {
    isSecureContext: boolean
    location: {
        host: string
        hostname: string
        port: string
        protocol: string
    }
}

// Models the one key record. Browser checks cover the native IndexedDB implementation.
export function createMemoryKeyDatabase(initialKey?: CryptoKey, abortWrites = false): IDBFactory {
    let key        = initialKey
    let write      = Promise.resolve()
    let created    = false
    const database = {
        createObjectStore: () => {
            created = true
        },
        close: () => {
        },
        transaction: (_name: string, mode: IDBTransactionMode) => {
            let pending: CryptoKey | undefined
            let aborted       = false
            const transaction = {
                error: new DOMException('Test key write aborted', 'AbortError'),
                onabort: undefined as (() => void) | undefined,
                oncomplete: undefined as (() => void) | undefined,
                abort: () => {
                    aborted = true
                },
                objectStore: () => ({
                    get: () => {
                        const request = {
                            result: undefined as CryptoKey | undefined,
                            onsuccess: undefined as (() => void) | undefined,
                        }
                        const ready   = write.then(() => {
                            request.result = structuredClone(key)
                            request.onsuccess?.()
                            if (aborted || (pending && abortWrites)) {
                                transaction.onabort?.()
                                return
                            }
                            if (pending) {
                                key = pending
                            }
                            transaction.oncomplete?.()
                        })
                        if (mode === 'readwrite') {
                            write = ready
                        }
                        return request
                    },
                    add: (value: CryptoKey) => {
                        if (key !== undefined || mode !== 'readwrite') {
                            throw new DOMException('Test key cannot be added', 'ConstraintError')
                        }
                        pending = structuredClone(value)
                    },
                }),
            }
            return transaction
        },
    }
    return {
        open: () => {
            const request = {
                result: database,
                onupgradeneeded: undefined as (() => void) | undefined,
                onsuccess: undefined as (() => void) | undefined,
            }
            queueMicrotask(() => {
                if (!created) {
                    request.onupgradeneeded?.()
                }
                request.onsuccess?.()
            })
            return request
        },
    } as unknown as IDBFactory
}

export function installMemoryStorageEnvironment(
    isSecureContext: boolean,
    initialKey?: CryptoKey,
): MemoryStorageWindow {
    const browserWindow = Object.assign(new EventTarget(), {
        isSecureContext,
        location: {
            host: 'secure-storage.test',
            hostname: 'secure-storage.test',
            port: '',
            protocol: 'https:',
        },
    })
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: browserWindow,
    })
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        writable: true,
        value: createMemoryStorage(),
    })
    Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        writable: true,
        value: createMemoryStorage(),
    })
    Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        writable: true,
        value: createMemoryKeyDatabase(initialKey),
    })
    return browserWindow
}
