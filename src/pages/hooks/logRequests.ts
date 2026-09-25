export interface LogRequestScope {
    generation: number
    authGeneration: number
}

export interface LogRequest extends LogRequestScope {
    controller: AbortController
}

export function createLogRequestGuard() {
    let generation = 0
    let active: LogRequest | null = null

    const capture = (authGeneration: number): LogRequestScope => ({ generation, authGeneration })

    const invalidate = (): void => {
        generation += 1
        active?.controller.abort()
        active = null
    }

    return {
        capture,
        invalidate,
        begin(authGeneration: number): LogRequest {
            invalidate()
            const request = {
                generation,
                authGeneration,
                controller: new AbortController(),
            }
            active = request
            return request
        },
        isCurrent(request: LogRequestScope, authGeneration: number): boolean {
            if (request.generation !== generation || request.authGeneration !== authGeneration) {
                return false
            }
            if (!('controller' in request)) {
                return true
            }
            return active === request && !active.controller.signal.aborted
        },
        finish(request: LogRequest): boolean {
            if (active !== request || request.generation !== generation) {
                return false
            }
            active = null
            return true
        },
    }
}

export function createLogRequestQueue() {
    let generation = 0
    let active: { request: LogRequest; clearing: boolean } | null = null
    let pendingFullReload = false

    const createRequest = (authGeneration: number): LogRequest => ({
        generation: ++generation,
        authGeneration,
        controller: new AbortController(),
    })

    const invalidate = (): void => {
        generation += 1
        active?.request.controller.abort()
        active = null
        pendingFullReload = false
    }

    return {
        invalidate,
        startRead(incremental: boolean, authGeneration: number): LogRequest | null {
            if (active) {
                if (!incremental) {
                    pendingFullReload = true
                    if (!active.clearing) {
                        active.request.controller.abort()
                    }
                }
                return null
            }
            const request = createRequest(authGeneration)
            active = { request, clearing: false }
            return request
        },
        startClear(authGeneration: number): LogRequest | null {
            if (active?.clearing) {
                return null
            }
            invalidate()
            const request = createRequest(authGeneration)
            active = { request, clearing: true }
            return request
        },
        isCurrent(request: LogRequest, authGeneration: number): boolean {
            return active?.request === request &&
                   request.generation === generation &&
                   request.authGeneration === authGeneration &&
                   !request.controller.signal.aborted
        },
        finish(
            request: LogRequest,
            authGeneration: number,
            reload = false,
        ): { finished: boolean; reload: boolean } {
            if (active?.request !== request || request.generation !== generation) {
                return { finished: false, reload: false }
            }
            active = null
            if (request.authGeneration !== authGeneration) {
                pendingFullReload = false
                return { finished: false, reload: false }
            }
            const shouldReload = pendingFullReload || reload
            pendingFullReload = false
            return { finished: true, reload: shouldReload }
        },
    }
}
