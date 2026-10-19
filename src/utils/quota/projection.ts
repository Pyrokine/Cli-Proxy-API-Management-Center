interface ProjectedQuotaProgress {
    percent: number | null
    resetAtMs: number | null | undefined
}

export const projectQuotaProgress = (
    percent: number | null,
    resetAtMs: number | null | undefined,
    nowMs: number,
): ProjectedQuotaProgress => ({
    percent:
        typeof resetAtMs === 'number' && Number.isFinite(resetAtMs) && resetAtMs <= nowMs
        ? null
        : percent,
    resetAtMs,
})
