/**
 * Bridge between QuotaStore and CredentialCard — reads cached quota data
 * for a given auth file and converts it to QuotaItem[] for display.
 */

import type {QuotaItem} from '@/components/credentials/CredentialCard'
import {useQuotaStore} from '@/stores/useQuotaStore'
import type {
    AntigravityQuotaState,
    ClaudeQuotaState,
    CodexQuotaState,
    GeminiCliQuotaState,
    KimiQuotaState,
} from '@/types'
import {formatQuotaResetTime} from '@/utils/quota/formatters'
import {useMemo} from 'react'

function fromAntigravity(state: AntigravityQuotaState): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.groups.map((g) => ({
        model: g.label,
        percent: Math.round(g.remainingFraction * 100),
        resetLabel: g.resetTime ? formatQuotaResetTime(g.resetTime) : undefined,
    }))
}

function fromClaude(state: ClaudeQuotaState): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.windows
                .filter((w) => w.usedPercent !== null)
                .map((w) => ({
                    model: w.label,
                    percent: Math.max(0, 100 - (w.usedPercent ?? 0)),
                    resetLabel: w.resetLabel || undefined,
                }))
}

function fromCodex(state: CodexQuotaState): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.windows
                .filter((w) => w.usedPercent !== null)
                .map((w) => ({
                    model: w.label,
                    percent: Math.max(0, 100 - (w.usedPercent ?? 0)),
                    resetLabel: w.resetLabel || undefined,
                }))
}

function fromGeminiCli(state: GeminiCliQuotaState): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.buckets
                .filter((b) => b.remainingFraction !== null)
                .map((b) => ({
                    model: b.label,
                    percent: Math.round((b.remainingFraction ?? 0) * 100),
                    resetLabel: b.resetTime ? formatQuotaResetTime(b.resetTime) : undefined,
                }))
}

function fromKimi(state: KimiQuotaState): QuotaItem[] {
    if (state.status !== 'success') {
        return []
    }
    return state.rows
                .filter((r) => r.limit > 0)
                .map((r) => ({
                    model: r.label ?? r.id,
                    percent: Math.round(Math.max(0, ((r.limit - r.used) / r.limit) * 100)),
                    resetLabel: r.resetHint || undefined,
                }))
}

interface CredentialQuotaResult {
    items?: QuotaItem[]
    error?: string
    loading?: boolean
    planType?: string | null
}

/**
 * Returns quota state for a given auth file name by checking all quota stores.
 * Includes items on success, error message on failure, and loading flag.
 */
export function useCredentialQuota(fileName: string): CredentialQuotaResult {
    const antigravity = useQuotaStore((s) => s.antigravityQuota[fileName])
    const claude      = useQuotaStore((s) => s.claudeQuota[fileName])
    const codex       = useQuotaStore((s) => s.codexQuota[fileName])
    const geminiCli   = useQuotaStore((s) => s.geminiCliQuota[fileName])
    const kimi        = useQuotaStore((s) => s.kimiQuota[fileName])

    return useMemo(() => {
        const states = [antigravity, claude, codex, geminiCli, kimi]
        const active = states.find((s) => s != null)
        if (!active) {
            return {}
        }

        if (active.status === 'loading') {
            return { loading: true }
        }

        if (active.status === 'error') {
            const error = (active as { error?: string }).error
            return { error: error || 'Unknown error' }
        }

        if (antigravity?.status === 'success') {
            return { items: fromAntigravity(antigravity) }
        }
        if (claude?.status === 'success') {
            return { items: fromClaude(claude), planType: claude.planType }
        }
        if (codex?.status === 'success') {
            return { items: fromCodex(codex), planType: codex.planType }
        }
        if (geminiCli?.status === 'success') {
            return { items: fromGeminiCli(geminiCli), planType: geminiCli.tierLabel }
        }
        if (kimi?.status === 'success') {
            return { items: fromKimi(kimi) }
        }

        return {}
    }, [antigravity, claude, codex, geminiCli, kimi])
}
