export interface OAuthAttempt {
    readonly signal: AbortSignal
    isCurrent: () => boolean
    isPolling: () => boolean
    invalidate: () => void
    schedule: (callback: () => void, delay: number) => void
    poll: <T>(
        request: () => Promise<T>,
        onResult: (result: T) => boolean,
        onError: (error: unknown) => void,
        delay: number,
    ) => void
}

interface OAuthAttemptScheduler {
    setTimeout: (callback: () => void, delay: number) => number
    clearTimeout: (timer: number) => void
    getGeneration: () => number
}

interface OAuthAttemptStatus {
    status: 'ok' | 'wait' | 'error'
    phase?: string
    error?: string
}

export function shouldFinalizeOAuthAttempt(result: OAuthAttemptStatus): boolean {
    return result.status === 'ok' || (result.status === 'error' && result.phase === 'expired')
}

export function createOAuthAttempts(scheduler: OAuthAttemptScheduler) {
    const attempts = new Map<string, OAuthAttempt>()

    const begin = (owner: string): OAuthAttempt => {
        attempts.get(owner)?.invalidate()
        let timer: number | undefined
        let polling = false
        const generation = scheduler.getGeneration()
        const controller = new AbortController()
        const ownsAttempt = () => attempts.get(owner) === attempt
        const attempt: OAuthAttempt = {
            signal: controller.signal,
            isCurrent: () => ownsAttempt() && generation === scheduler.getGeneration(),
            isPolling: () => polling && attempt.isCurrent(),
            invalidate: () => {
                if (timer !== undefined) {
                    scheduler.clearTimeout(timer)
                }
                timer = undefined
                polling = false
                if (ownsAttempt()) {
                    attempts.delete(owner)
                }
                controller.abort()
            },
            schedule: (callback, delay) => {
                if (!attempt.isCurrent()) {
                    return
                }
                if (timer !== undefined) {
                    scheduler.clearTimeout(timer)
                }
                timer = scheduler.setTimeout(() => {
                    timer = undefined
                    if (attempt.isCurrent()) {
                        callback()
                    }
                }, delay)
            },
            poll: (request, onResult, onError, delay) => {
                if (!attempt.isCurrent() || polling) {
                    return
                }
                polling = true
                const tick = async () => {
                    try {
                        const result = await request()
                        if (!attempt.isCurrent()) {
                            return
                        }
                        if (onResult(result)) {
                            attempt.schedule(() => void tick(), delay)
                        } else {
                            polling = false
                        }
                    } catch (error) {
                        if (attempt.isCurrent()) {
                            polling = false
                            onError(error)
                        }
                    }
                }
                attempt.schedule(() => void tick(), delay)
            },
        }
        attempts.set(owner, attempt)
        return attempt
    }

    return {
        begin,
        get: (owner: string) => attempts.get(owner),
        invalidateAll: () => {
            for (const attempt of attempts.values()) {
                attempt.invalidate()
            }
        },
    }
}
