export const SECOND_MS = 1_000
export const MINUTE_MS = 60_000
export const HOUR_MS   = 3_600_000
export const DAY_MS    = 24 * HOUR_MS

export function getCooldownRemainingSeconds(
    remainingSeconds: number,
    receivedAtMs: number,
    nowMs: number,
): number {
    const elapsedMs = Math.max(0, nowMs - receivedAtMs)
    return Math.max(0, Math.ceil(remainingSeconds - elapsedMs / SECOND_MS))
}
