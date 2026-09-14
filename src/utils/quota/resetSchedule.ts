import {HOUR_MS} from '@/utils/time/durations'

interface QuotaRecoveryCandidate {
    rowId: string
    atMs: number
}

function pickSoonestRecoveryRowId(
    candidates: readonly QuotaRecoveryCandidate[],
    nowMs: number,
): string | null {
    let selected: QuotaRecoveryCandidate | null = null
    for (const candidate of candidates) {
        if (!Number.isFinite(candidate.atMs) || candidate.atMs <= nowMs) {
            continue
        }
        if (
            selected === null ||
            candidate.atMs < selected.atMs ||
            (candidate.atMs === selected.atMs && candidate.rowId < selected.rowId)
        ) {
            selected = candidate
        }
    }
    return selected?.rowId ?? null
}

export function pickUrgentRecoveryRowId(
    candidates: readonly QuotaRecoveryCandidate[],
    nowMs: number,
): string | null {
    return pickSoonestRecoveryRowId(
        candidates.filter((candidate) => candidate.atMs - nowMs > 0 && candidate.atMs - nowMs < HOUR_MS),
        nowMs,
    )
}
