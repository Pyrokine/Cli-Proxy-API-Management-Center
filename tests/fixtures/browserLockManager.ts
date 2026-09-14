type LockOperation<T> = () => PromiseLike<T> | T

export const AUTH_STORAGE_TEST_LOCK_NAME = 'cli-proxy-auth:storage-lock'

export class TestLockManager {
    private readonly heldLocks = new Set<string>()
    private readonly queues    = new Map<string, Array<() => void>>()

    request<T>(name: string, operation: LockOperation<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const run = () => {
                this.heldLocks.add(name)
                let result: PromiseLike<T> | T
                try {
                    result = operation()
                } catch (error: unknown) {
                    this.release(name)
                    reject(error)
                    return
                }
                Promise.resolve(result).then(
                    (value) => {
                        this.release(name)
                        resolve(value)
                    },
                    (error: unknown) => {
                        this.release(name)
                        reject(error)
                    },
                )
            }

            if (this.heldLocks.has(name)) {
                const queue = this.queues.get(name) ?? []
                queue.push(run)
                this.queues.set(name, queue)
                return
            }
            run()
        })
    }

    private release(name: string): void {
        const queue = this.queues.get(name)
        const next  = queue?.shift()
        if (next) {
            next()
            return
        }
        this.queues.delete(name)
        this.heldLocks.delete(name)
    }
}

export function installTestLockManager(): TestLockManager {
    const manager   = new TestLockManager()
    const userAgent = typeof navigator !== 'undefined' && navigator.userAgent ?
                      navigator.userAgent :
                      'secure-storage-test'
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        writable: true,
        value: {
            language: 'en-US',
            languages: ['en-US'],
            userAgent,
            locks: manager,
        } as unknown as Navigator,
    })
    return manager
}
