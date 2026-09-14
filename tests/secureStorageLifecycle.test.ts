import {afterEach, beforeEach, describe, expect, test} from 'bun:test'
import {fileURLToPath} from 'node:url'
import {secureStorage} from '@/services/storage/secureStorage'
import {encryptData} from '@/utils/encryption'
import {
    installMemoryStorageEnvironment,
    type MemoryStorageWindow,
} from './fixtures/memoryStorage'

const originalDescriptors = new Map(
    ['window', 'localStorage', 'sessionStorage'].map((name) => [
        name,
        Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
)

let browserWindow: MemoryStorageWindow

async function runFixture(fixture: string, args: string[] = []): Promise<string> {
    const child                      = Bun.spawn([process.execPath, fixture, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
                                                             child.exited,
                                                             new Response(child.stdout).text(),
                                                             new Response(child.stderr).text(),
                                                         ])
    if (exitCode !== 0) {
        throw new Error(stderr || stdout || `auth lifecycle fixture exited with ${exitCode}`)
    }
    return stdout.trim()
}

function installSubtleCrypto(originalCrypto: Crypto, subtle: SubtleCrypto): () => void {
    const cryptoProxy = new Proxy(originalCrypto, {
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
    return () => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            writable: true,
            value: originalCrypto,
        })
    }
}

beforeEach(() => {
    browserWindow = installMemoryStorageEnvironment(true)
})

afterEach(() => {
    for (const [name, descriptor] of originalDescriptors) {
        if (descriptor) {
            Object.defineProperty(globalThis, name, descriptor)
        } else {
            Reflect.deleteProperty(globalThis, name)
        }
    }
})

describe('secure storage lifecycle', () => {
    test('does not write plaintext when Web Crypto is unavailable', async () => {
        browserWindow.isSecureContext = false
        localStorage.setItem('secret', 'plain::stale-local')
        sessionStorage.setItem('secret', 'plain::stale-session')

        // noinspection ES6RedundantAwait
        await expect(encryptData('secret')).rejects.toThrow('Encrypted storage is unavailable')
        expect(await secureStorage.setItem('secret', 'secret')).toBe('memory-only')
        expect(localStorage.getItem('secret')).toBeNull()
        expect(sessionStorage.getItem('secret')).toBeNull()
    })

    test('does not write plaintext when Web Crypto encryption fails', async () => {
        const originalCrypto = globalThis.crypto
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            writable: true,
            value: {
                subtle: originalCrypto.subtle,
                getRandomValues: () => {
                    throw new Error('random unavailable')
                },
            } as unknown as Crypto,
        })

        try {
            expect(await secureStorage.setItem('secret', 'secret')).toBe('memory-only')
            expect(localStorage.getItem('secret')).toBeNull()
            expect(sessionStorage.getItem('secret')).toBeNull()
        } finally {
            Object.defineProperty(globalThis, 'crypto', {
                configurable: true,
                writable: true,
                value: originalCrypto,
            })
        }
    })

    test('preserves protected storage when a replacement write fails', async () => {
        expect(await secureStorage.setItem('secret', 'protected', { persistent: true })).toBe('stored')
        const encrypted      = localStorage.getItem('secret')
        const originalSet    = localStorage.setItem
        localStorage.setItem = () => {
            throw new Error('storage unavailable')
        }

        try {
            expect(await secureStorage.setItem('secret', 'replacement', { persistent: true })).toBe('memory-only')
            expect(localStorage.getItem('secret')).toBe(encrypted)
        } finally {
            localStorage.setItem = originalSet
        }
    })

    test('does not let a late failed write delete current storage', async () => {
        const originalCrypto = globalThis.crypto
        let rejectEncryption = () => {
        }
        let markStarted      = () => {
        }
        const started        = new Promise<void>((resolve) => {
            markStarted = resolve
        })
        const rejected       = new Promise<ArrayBuffer>((_resolve, reject) => {
            rejectEncryption = () => reject(new Error('late encryption failure'))
        })
        let encryptCalls     = 0
        const subtle         = new Proxy(originalCrypto.subtle, {
            get: (target, property) => {
                const value = Reflect.get(target, property, target)
                if (property === 'encrypt') {
                    return (...args: Parameters<SubtleCrypto['encrypt']>) => {
                        encryptCalls += 1
                        if (encryptCalls === 1) {
                            markStarted()
                            return rejected
                        }
                        return Reflect.apply(value, target, args)
                    }
                }
                return typeof value === 'function' ? value.bind(target) : value
            },
        })
        const restoreCrypto  = installSubtleCrypto(originalCrypto, subtle)

        try {
            let generation   = 1
            const staleWrite = secureStorage.setItem('secret', 'stale', {
                persistent: true,
                shouldCommit: () => generation === 1,
            })
            await started
            generation = 2
            expect(await secureStorage.setItem('secret', 'current', { persistent: true })).toBe('stored')
            const current = localStorage.getItem('secret')
            rejectEncryption()
            expect(await staleWrite).toBe('cancelled')
            expect(localStorage.getItem('secret')).toBe(current)
        } finally {
            restoreCrypto()
        }
    })

    test('does not let a superseded encrypted write replace current storage', async () => {
        expect(await secureStorage.setItem('secret', 'current', { persistent: true })).toBe('stored')
        const current = localStorage.getItem('secret')

        expect(await secureStorage.setItem('secret', 'stale', {
            persistent: true,
            shouldCommit: () => false,
        })).toBe('cancelled')
        expect(localStorage.getItem('secret')).toBe(current)
    })

    test('distinguishes absent, invalid, and unreadable values', async () => {
        expect(await secureStorage.getItemResult('missing')).toEqual({ status: 'absent', value: null })

        sessionStorage.setItem('invalid', JSON.stringify('plaintext'))
        expect(await secureStorage.getItemResult('invalid')).toEqual({ status: 'invalid', value: null })
        expect(sessionStorage.getItem('invalid')).toBeNull()

        sessionStorage.setItem('malformed', 'enc::v2::not-base64')
        expect(await secureStorage.getItemResult('malformed')).toEqual({ status: 'invalid', value: null })
        expect(sessionStorage.getItem('malformed')).toBeNull()

        sessionStorage.setItem('legacy-malformed', 'enc::v1::not-base64')
        expect(await secureStorage.getItemResult('legacy-malformed')).toEqual({ status: 'invalid', value: null })
        expect(sessionStorage.getItem('legacy-malformed')).toBeNull()
    })

    test('preserves valid ciphertext when decryption is temporarily unavailable', async () => {
        expect(await secureStorage.setItem('secret', 'protected', { persistent: true })).toBe('stored')
        const encrypted      = localStorage.getItem('secret')
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
        const restoreCrypto  = installSubtleCrypto(originalCrypto, subtle)

        try {
            expect(await secureStorage.getItemResult<string>('secret', { persistent: true })).toEqual({
                                                                                                          status: 'unreadable',
                                                                                                          value: null,
                                                                                                      })
            expect(localStorage.getItem('secret')).toBe(encrypted)
        } finally {
            restoreCrypto()
        }
    })

    test('migrates a legacy plaintext value exactly once', async () => {
        localStorage.setItem('legacy', `plain::${JSON.stringify('legacy-secret')}`)

        expect(await secureStorage.getItemResult<string>('legacy', { persistent: true })).toEqual({
                                                                                                      status: 'value',
                                                                                                      value: 'legacy-secret',
                                                                                                  })
        const migrated = localStorage.getItem('legacy')
        expect(migrated?.startsWith('enc::v2::')).toBe(true)
        expect(migrated?.includes('plain::')).toBe(false)

        expect(await secureStorage.getItemResult<string>('legacy', { persistent: true })).toEqual({
                                                                                                      status: 'value',
                                                                                                      value: 'legacy-secret',
                                                                                                  })
        expect(localStorage.getItem('legacy')).toBe(migrated)
    })

    test('rejects and removes plaintext when migration cannot encrypt it', async () => {
        localStorage.setItem('legacy', `plain::${JSON.stringify('legacy-secret')}`)
        browserWindow.isSecureContext = false

        expect(await secureStorage.getItemResult<string>('legacy', { persistent: true })).toEqual({
                                                                                                      status: 'invalid',
                                                                                                      value: null,
                                                                                                  })
        expect(localStorage.getItem('legacy')).toBeNull()
    })

    test('does not accept a migrated copy when the legacy source cannot be invalidated', async () => {
        const legacy         = `plain::${JSON.stringify('legacy-secret')}`
        const originalRemove = localStorage.removeItem
        const originalSet    = localStorage.setItem
        localStorage.setItem('legacy', legacy)
        localStorage.removeItem = () => {
            throw new Error('remove unavailable')
        }
        localStorage.setItem    = () => {
            throw new Error('write unavailable')
        }

        try {
            expect(await secureStorage.getItemResult<string>('legacy')).toEqual({
                                                                                    status: 'invalid',
                                                                                    value: null,
                                                                                })
            expect(sessionStorage.getItem('legacy')).toBeNull()
            expect(localStorage.getItem('legacy')).toBe(legacy)
        } finally {
            localStorage.removeItem = originalRemove
            localStorage.setItem    = originalSet
        }
    })

    test('keeps protected ciphertext when the current context cannot decrypt it', async () => {
        expect(await secureStorage.setItem('secret', 'protected', { persistent: true })).toBe('stored')
        const encrypted               = localStorage.getItem('secret')
        browserWindow.isSecureContext = false

        expect(await secureStorage.getItemResult<string>('secret', { persistent: true })).toEqual({
                                                                                                      status: 'unreadable',
                                                                                                      value: null,
                                                                                                  })
        expect(localStorage.getItem('secret')).toBe(encrypted)
    })

    test('returns fail-closed outcomes when a Storage accessor throws', async () => {
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            get: () => {
                throw new DOMException('storage unavailable', 'SecurityError')
            },
        })

        expect(await secureStorage.setItem('secret', 'secret', { persistent: true })).toBe('memory-only')
        expect(secureStorage.removeItem('secret', { persistent: true })).toBe(false)
    })

    test('uses a secret-free tombstone when removeItem fails', () => {
        localStorage.setItem('secret', 'enc::v2::protected')
        const originalRemove    = localStorage.removeItem
        localStorage.removeItem = () => {
            throw new Error('remove unavailable')
        }

        try {
            expect(secureStorage.removeItem('secret', { persistent: true })).toBe(true)
            expect(localStorage.getItem('secret')).toBe('invalidated::')
        } finally {
            localStorage.removeItem = originalRemove
        }
    })

    test('reports cleanup failure when removeItem and tombstone writes fail', () => {
        localStorage.setItem('secret', 'enc::v2::protected')
        const originalRemove    = localStorage.removeItem
        const originalSet       = localStorage.setItem
        localStorage.removeItem = () => {
            throw new Error('remove unavailable')
        }
        localStorage.setItem    = () => {
            throw new Error('write unavailable')
        }

        try {
            expect(secureStorage.removeItem('secret', { persistent: true })).toBe(false)
            expect(localStorage.getItem('secret')).toBe('enc::v2::protected')
        } finally {
            localStorage.removeItem = originalRemove
            localStorage.setItem    = originalSet
        }
    })

    test('keeps unavailable storage in memory and clears persisted credentials after a 401', async () => {
        const fixture = fileURLToPath(new URL('./fixtures/secureStorageAuthLifecycle.ts', import.meta.url))
        expect(await runFixture(fixture)).toBe('secure-storage-auth-lifecycle=PASS')
    })

    test('covers authentication recovery, ordering, migration, and cleanup boundaries', async () => {
        const fixture   = fileURLToPath(new URL('./fixtures/secureStorageAuthRecovery.ts', import.meta.url))
        const scenarios = [
            'persistent-unreadable',
            'session-unreadable',
            'unreadable-bundle-invalid-metadata',
            'session-barrier',
            'local-barrier-preserves-shared-login',
            'invalid-state',
            'legacy-migration-failure',
            'encoded-prefix-key',
            'same-generation-write',
            'stale-login',
            'pending-cross-tab-login-blocks-restore',
            'cross-tab-restore-claim',
            'cross-tab-delayed-login',
            'cross-tab-stale-401',
            'cross-tab-logout-ordering',
            'cross-tab-pending-login-stale-401',
            'cross-tab-memory-only-stale-401',
            'stale-auth-blob',
            'mismatched-legacy-sources',
            'current-login-401',
            'memory-only-successful-retry',
            'memory-only-retry',
            'remember-switch',
            'tombstone',
            'clear-failure',
            'lock-request-failure',
            'lock-unavailable',
            'transient-denial-reload',
        ]
        const outputs   = await Promise.all(
            scenarios.map((scenario) => runFixture(fixture, [scenario])),
        )
        expect(outputs).toEqual(
            scenarios.map((scenario) => `secure-storage-auth-recovery:${scenario}=PASS`),
        )
    })

    test('keeps the committed credential snapshot after a non-401 login failure', async () => {
        const fixture  = fileURLToPath(new URL('./fixtures/secureStorageAuthRecovery.ts', import.meta.url))
        const prepared = await runFixture(fixture, ['prepare-protected-login-failure'])
        const payload  = Buffer.from(prepared, 'utf8').toString('base64url')
        expect(await runFixture(fixture, ['protected-login-failure-reload', payload])).toBe(
            'secure-storage-auth-recovery:protected-login-failure-reload=PASS',
        )
    })

    test('commits apiBase and managementKey as one credential snapshot', async () => {
        const fixture  = fileURLToPath(new URL('./fixtures/secureStorageAuthRecovery.ts', import.meta.url))
        const prepared = await runFixture(fixture, ['prepare-atomic-credential-write'])
        const payload  = Buffer.from(prepared, 'utf8').toString('base64url')
        expect(await runFixture(fixture, ['atomic-credential-write-reload', payload])).toBe(
            'secure-storage-auth-recovery:atomic-credential-write-reload=PASS',
        )
    })

    test('keeps a newer cross-tab login after the stale tab reloads', async () => {
        const fixture  = fileURLToPath(new URL('./fixtures/secureStorageAuthRecovery.ts', import.meta.url))
        const prepared = await runFixture(fixture, ['prepare-cross-tab-stale-401-reload'])
        const payload  = Buffer.from(prepared, 'utf8').toString('base64url')
        expect(await runFixture(fixture, ['cross-tab-stale-401-reload', payload])).toBe(
            'secure-storage-auth-recovery:cross-tab-stale-401-reload=PASS',
        )
    })

    test('does not restore a session credential after another tab clears the shared intent', async () => {
        const fixture  = fileURLToPath(new URL('./fixtures/secureStorageAuthRecovery.ts', import.meta.url))
        const prepared = await runFixture(fixture, ['prepare-session-logout-reload'])
        const payload  = Buffer.from(prepared, 'utf8').toString('base64url')
        expect(await runFixture(fixture, ['session-logout-reload', payload])).toBe(
            'secure-storage-auth-recovery:session-logout-reload=PASS',
        )
    })

    test('blocks a fresh process from restoring credentials after both Storage APIs reject invalidation', async () => {
        const fixture  = fileURLToPath(new URL('./fixtures/secureStorageAuthRecovery.ts', import.meta.url))
        const prepared = await runFixture(fixture, ['prepare-total-denial-reload'])
        const payload  = Buffer.from(prepared, 'utf8').toString('base64url')
        expect(await runFixture(fixture, ['total-denial-reload', payload])).toBe(
            'secure-storage-auth-recovery:total-denial-reload=PASS',
        )
        expect(await runFixture(fixture, ['other-port-cookie', payload])).toBe(
            'secure-storage-auth-recovery:other-port-cookie=PASS',
        )
    })
})
