/**
 * Register auth files with the global quota scheduler.
 *
 * On mount, iterates auth files and registers a fetchFn for each file
 * that matches a known quota config. On unmount, unregisters them.
 */

import type {QuotaConfig} from '@/components/quota/quotaConfigs'
import {
    ANTIGRAVITY_CONFIG,
    CLAUDE_CONFIG,
    CODEX_CONFIG,
    GEMINI_CLI_CONFIG,
    KIMI_CONFIG,
} from '@/components/quota/quotaConfigs'
import {useQuotaScheduler} from '@/services/quota/useQuotaScheduler'
import {useQuotaStore} from '@/stores/useQuotaStore'
import type {AuthFileItem} from '@/types/authFile'
import {useEffect, useRef} from 'react'
import {useTranslation} from 'react-i18next'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL_CONFIGS: QuotaConfig<any, any>[] = [
    ANTIGRAVITY_CONFIG,
    CLAUDE_CONFIG,
    CODEX_CONFIG,
    GEMINI_CLI_CONFIG,
    KIMI_CONFIG,
]

/** Find the first matching quota config for a given auth file. */
function findQuotaConfig(file: AuthFileItem) {
    return ALL_CONFIGS.find((cfg) => cfg.filterFn(file)) ?? null
}

/**
 * Register all auth files with the quota scheduler.
 * Returns the scheduler instance for reading refresh state.
 */
export function useQuotaRegistration(authFiles: AuthFileItem[]) {
    const scheduler = useQuotaScheduler()
    const { t }     = useTranslation()
    const tRef      = useRef(t)
    tRef.current    = t

    const store         = useQuotaStore
    const registeredRef = useRef(new Set<string>())

    useEffect(() => {
        const toRegister = new Set<string>()

        for (const file of authFiles) {
            const config = findQuotaConfig(file)
            if (!config) {
                continue
            }

            toRegister.add(file.name)

            if (registeredRef.current.has(file.name)) {
                continue
            }

            const fetchFn = async () => {
                const setter = store.getState()[config.storeSetter] as (
                    updater: (prev: Record<string, unknown>) => Record<string, unknown>,
                ) => void

                // Set loading
                setter((prev) => ({
                    ...prev,
                    [file.name]: config.buildLoadingState(),
                }))

                try {
                    const data = await config.fetchQuota(file, tRef.current)
                    setter((prev) => ({
                        ...prev,
                        [file.name]: config.buildSuccessState(data),
                    }))
                } catch (err: unknown) {
                    const message = err instanceof Error ? err.message : 'Unknown error'
                    setter((prev) => ({
                        ...prev,
                        [file.name]: config.buildErrorState(message),
                    }))
                    throw err // Let scheduler know it failed (for backoff)
                }
            }

            scheduler.register(file.name, fetchFn)
            registeredRef.current.add(file.name)
        }

        // Unregister files that are no longer present
        for (const name of registeredRef.current) {
            if (!toRegister.has(name)) {
                scheduler.unregister(name)
                registeredRef.current.delete(name)
            }
        }

        const registered = registeredRef.current
        return () => {
            for (const name of registered) {
                scheduler.unregister(name)
            }
            registered.clear()
        }
    }, [authFiles, scheduler, store])

    return scheduler
}
