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

export function installMemoryStorageEnvironment(isSecureContext: boolean): MemoryStorageWindow {
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
    return browserWindow
}
