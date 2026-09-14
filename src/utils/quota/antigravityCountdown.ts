import {MINUTE_MS} from '@/utils/time/durations'

export function resolveAntigravityNowMs(nowMs: number, serverTimeOffsetMs?: number | null): number {
    const offset = typeof serverTimeOffsetMs === 'number' && Number.isFinite(serverTimeOffsetMs) ?
                   serverTimeOffsetMs :
                   0
    return nowMs + offset
}

export function getNextAntigravityCountdownUpdateDelay(
    resetTimestamps: readonly number[],
    nowMs: number,
): number | null {
    let nextDelay: number | null = null

    for (const resetMs of resetTimestamps) {
        if (!Number.isFinite(resetMs)) {
            continue
        }
        const deltaMs = resetMs - nowMs
        if (deltaMs <= 0) {
            continue
        }
        const remainder = deltaMs % MINUTE_MS
        const delay     = Math.max(1, Math.ceil(remainder === 0 ? MINUTE_MS : remainder))
        nextDelay       = nextDelay === null ? delay : Math.min(nextDelay, delay)
    }

    return nextDelay
}
