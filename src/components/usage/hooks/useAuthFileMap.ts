import { formatAuthFileDisplayName } from '@/features/authFiles/constants'
import { authFilesApi } from '@/services/api/authFiles'
import type { AuthFileItem } from '@/types/authFile'
import type { CredentialInfo } from '@/types/sourceInfo'
import { normalizeAuthIndex } from '@/utils/usage'
import { useEffect, useState } from 'react'

/**
 * Shared hook that fetches auth files once and builds a Map<authIndex, CredentialInfo>.
 * Used by CredentialStatsCard and RequestEventsDetailsCard to avoid duplicate fetches.
 */
export function useAuthFileMap(enabled = true) {
    const [authFileMap, setAuthFileMap] = useState<Map<string, CredentialInfo>>(new Map())
    const [authFileMapLoading, setAuthFileMapLoading] = useState(false)

    useEffect(() => {
        if (!enabled) {
            return
        }
        let cancelled = false
        const raf = requestAnimationFrame(() => {
            if (!cancelled) {
                setAuthFileMapLoading(true)
            }
        })
        authFilesApi
            .list()
            .then((res) => {
                if (cancelled) {
                    return
                }
                const files = Array.isArray(res) ? res : (res as { files?: AuthFileItem[] })?.files
                if (!Array.isArray(files)) {
                    return
                }
                const map = new Map<string, CredentialInfo>()
                files.forEach((file) => {
                    const key = normalizeAuthIndex(file['auth_index'] ?? file.authIndex)
                    if (key) {
                        map.set(key, {
                            name: formatAuthFileDisplayName(file.name || key) || key,
                            rawName: file.name || key,
                            type: (file.type || file.provider || '').toString(),
                        })
                    }
                })
                setAuthFileMap(map)
            })
            .catch(() => {})
            .finally(() => {
                if (!cancelled) {
                    setAuthFileMapLoading(false)
                }
            })
        return () => {
            cancelled = true
            cancelAnimationFrame(raf)
        }
    }, [enabled])

    return { authFileMap, authFileMapLoading }
}
