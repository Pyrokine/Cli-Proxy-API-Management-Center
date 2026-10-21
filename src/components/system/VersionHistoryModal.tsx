import {Button} from '@/components/ui/Button'
import {IconChevronLeft, IconDownload, IconExternalLink} from '@/components/ui/icons'
import {Modal} from '@/components/ui/Modal'
import {apiClient} from '@/services/api/client'
import type {Release, ReleasesTarget} from '@/services/api/releases'
import {releasesApi} from '@/services/api/releases'
import type {UpdateCompatibility, UpdateStatus} from '@/services/api/update'
import {updateApi} from '@/services/api/update'
import {useAuthStore, useNotificationStore} from '@/stores'
import {formatDateTime} from '@/utils/format'
import {safeExternalUrl} from '@/utils/validation'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './VersionHistoryModal.module.scss'

/* ---------- constants ---------- */

const OFFICIAL_REPOSITORIES: Record<ReleasesTarget, string> = {
    cpa: 'Pyrokine/CLIProxyAPI',
    panel: 'Pyrokine/Cli-Proxy-API-Management-Center',
}
const BREAKING_PATTERN                                      = /\b(?:breaking|migration|migrate|incompatible)\b|⚠/i
const NON_BREAKING_PATTERN                                  = new RegExp(
    String.raw`\b(?:non[- ]breaking|(?:no|without)\s+(?:a\s+)?(?:(?:schema|database|data)\s+)?` +
    String.raw`(?:migrations?(?!\s+(?:path|support))|breaking\s+changes?|incompatibility|incompatibilities)|` +
    String.raw`(?:does\s+not|doesn't)\s+(?:add|require|introduce)\s+(?:a\s+)?` +
    String.raw`(?:(?:schema|database|data)\s+)?migration|` +
    String.raw`(?:(?:schema|database|data)\s+)?migration\s+(?:is\s+)?not\s+(?:required|needed)|` +
    String.raw`not\s+incompatible)\b`,
    'gi',
)
const COMPATIBILITY_PATTERN                                 = new RegExp(
    String.raw`\b(?:required|requires|compatible|compatibility|` +
    String.raw`incompatible|incompatibility|breaking|migration|migrate)\b|` +
    '要求|兼容|相容|不兼容|迁移|遷移|⚠',
    'i',
)
const UPDATE_POLL_INTERVAL                                  = 2000
const UPDATE_POLL_RECONNECT_TIMEOUT                         = 120000
const PAGE_SIZE                                             = 10

/* ---------- types ---------- */

interface VersionHistoryModalProps {
    open: boolean
    onClose: () => void
    currentVersion: string
    target: ReleasesTarget
    repository?: string
}

/* ---------- helpers ---------- */

/** Parse "v1.3.2-augmented.1" or "v1.3.2-aug.1" → { major, minor, patch, aug, groupKey } */
function parseVersion(tag: string) {
    const match = tag
        .replace(/^v/i, '')
        .replace(/\+[0-9a-z-]+(?:\.[0-9a-z-]+)*$/i, '')
        .match(/^(?<major>\d+)\.(?<minor>\d+)(?:\.(?<patch>\d+))?(?:-(?:aug|augmented)\.(?<aug>\d+)|-sync\.\d{8})?$/i)
    if (!match?.groups) {
        return null
    }
    const major = Number(match.groups.major)
    const minor = Number(match.groups.minor)
    const patch = match.groups.patch !== undefined ? Number(match.groups.patch) : 0
    const aug   = match.groups.aug !== undefined ? Number(match.groups.aug) : 0
    return { major, minor, patch, aug, groupKey: `${major}.${minor}` }
}

/** Compare two semver tuples: returns negative if a < b, positive if a > b. */
function compareSemver(a: { major: number; minor: number; patch: number; aug: number }, b: typeof a) {
    if (a.major !== b.major) {
        return a.major - b.major
    }
    if (a.minor !== b.minor) {
        return a.minor - b.minor
    }
    if (a.patch !== b.patch) {
        return a.patch - b.patch
    }
    return a.aug - b.aug
}

/** Check if a release body mentions breaking changes. */
function extractBreakingHints(body: string): string[] {
    if (!body) {
        return []
    }
    const lines = body.split('\n')
    return lines.filter((line) => BREAKING_PATTERN.test(line.replace(NON_BREAKING_PATTERN, ''))).map((l) => l.trim())
}

/** Classify a release body line into features / fixes / other for side-by-side display. */
interface ReleaseSections {
    features: string[]
    fixes: string[]
    other: string[]
}

const FEATURE_SECTION_PATTERN = new RegExp(
    String.raw`^(?:#+\s*)?(?:features?|enhancements?|` +
    String.raw`新增|特性|功能|added|new|what's changed|whats changed|` +
    String.raw`更新内容|变更)\b`,
    'i',
)
const FIX_SECTION_PATTERN     = /^(?:#+\s*)?(?:fix(?:es)?|bug\s*fix(?:es)?|修复|bugs?)\b/i

function classifyReleaseBody(body: string): ReleaseSections {
    const sections: ReleaseSections = { features: [], fixes: [], other: [] }
    if (!body) {
        return sections
    }
    let bucket: keyof ReleaseSections = 'other'
    for (const raw of body.split('\n')) {
        const line = raw.trimEnd()
        if (!line.trim()) {
            continue
        }
        if (/^#{1,6}\s+/.test(line)) {
            const heading = line.replace(/^#+\s+/, '')
            if (FEATURE_SECTION_PATTERN.test(heading)) {
                bucket = 'features'
            } else if (FIX_SECTION_PATTERN.test(heading)) {
                bucket = 'fixes'
            } else {
                bucket = 'other'
            }
            continue
        }
        const content = line.replace(/^\s*[-*•]\s*/, '').trim()
        if (!content) {
            continue
        }
        sections[bucket].push(content)
    }
    return sections
}

/** Collect breaking changes between current version and target version from all releases. */
function collectBreakingBetween(releases: Release[], currentTag: string, targetTag: string): string[] {
    const current = parseVersion(currentTag)
    const target  = parseVersion(targetTag)
    if (!current || !target) {
        return []
    }

    // Only relevant when downgrading — warn about features lost
    if (compareSemver(current, target) <= 0) {
        return []
    }

    const hints: string[] = []
    for (const release of releases) {
        const parsed = parseVersion(release.tag_name)
        if (!parsed) {
            continue
        }
        // Releases between target (exclusive) and current (inclusive)
        if (compareSemver(parsed, target) > 0 && compareSemver(parsed, current) <= 0) {
            hints.push(...extractBreakingHints(release.body))
        }
    }
    return hints
}

function cleanReleaseLine(line: string): string {
    return line
        .replace(/^#+\s*/, '')
        .replace(/^[-*•]\s*/, '')
        .trim()
}

function uniqueNonEmpty(lines: string[]): string[] {
    const seen = new Set<string>()
    return lines.filter((line) => {
        const cleaned = cleanReleaseLine(line)
        if (!cleaned || seen.has(cleaned)) {
            return false
        }
        seen.add(cleaned)
        return true
    }).map(cleanReleaseLine)
}

function extractCompatibilityHints(body: string): string[] {
    if (!body) {
        return []
    }
    return uniqueNonEmpty(body.split('\n').filter((line) => COMPATIBILITY_PATTERN.test(line))).slice(0, 6)
}

function extractRequiredServerVersion(body: string): string | null {
    if (!body) {
        return null
    }
    const patterns = [
        /Required\s+server\s*[:：]\s*(?:CLIProxyAPI\s*)?v?(?<version>[0-9][\w.-]*)/i,
        /requires\s+(?:CLIProxyAPI\s*)?v?(?<version>[0-9][\w.-]*)/i,
        /要求的后端版本\s*[:：]\s*(?:CLIProxyAPI\s*)?v?(?<version>[0-9][\w.-]*)/i,
        /要求的後端版本\s*[:：]\s*(?:CLIProxyAPI\s*)?v?(?<version>[0-9][\w.-]*)/i,
        /要求.*(?:后端|後端|server|CLIProxyAPI).*v?(?<version>[0-9][\w.-]*)/i,
    ]
    for (const pattern of patterns) {
        const match = body.match(pattern)
        if (match?.groups?.version) {
            return `v${match.groups.version.replace(/^v/i, '')}`
        }
    }
    return null
}

function compareVersionStrings(current: string | null | undefined, required: string | null | undefined): number | null {
    const currentParsed  = parseVersion(current || '')
    const requiredParsed = parseVersion(required || '')
    if (!currentParsed || !requiredParsed) {
        return null
    }
    return compareSemver(currentParsed, requiredParsed)
}

/** Format ISO date to locale date-time. */
function formatDate(iso: string, locale: string): string {
    const formatted = formatDateTime(iso, locale)
    return formatted === '-' ? iso : formatted
}

/* ---------- component ---------- */

export function VersionHistoryModal({ open, onClose, currentVersion, target, repository }: VersionHistoryModalProps) {
    const { t, i18n }                            = useTranslation()
    const { showConfirmation, showNotification } = useNotificationStore()
    const serverVersion                          = useAuthStore((state) => state.serverVersion)
    const refreshServerVersion                   = useAuthStore((state) => state.refreshServerVersion)
    const authGeneration                         = apiClient.getAuthGeneration()

    const [releases, setReleases]   = useState<Release[]>([])
    const [loading, setLoading]     = useState(false)
    const [error, setError]         = useState<string | null>(null)
    const [pageIndex, setPageIndex] = useState(0)

    // Update progress
    const [updateStatus, setUpdateStatus]       = useState<UpdateStatus | null>(null)
    const [updatingVersion, setUpdatingVersion] = useState<string | null>(null)
    const [checkingVersion, setCheckingVersion] = useState<string | null>(null)
    const [pollingReady, setPollingReady]       = useState(false)
    const [pollError, setPollError]             = useState<string | null>(null)

    // Fetch releases when modal opens
    const viewGeneration = useRef(0)
    const [previousView, setPreviousView] = useState({open: false, target, authGeneration})
    if (open !== previousView.open || target !== previousView.target || authGeneration !== previousView.authGeneration) {
        viewGeneration.current += 1
        setPreviousView({open, target, authGeneration})
        setCheckingVersion(null)
        setUpdateStatus(null)
        setUpdatingVersion(null)
        setPollError(null)
        setPollingReady(open && target === 'cpa')
        if (open) {
            setLoading(true)
            setError(null)
        }
    }

    useEffect(() => {
        if (!open) {
            return
        }
        let cancelled = false

        releasesApi
            .list(1, 100, target)
            .then((res) => {
                if (cancelled || authGeneration !== apiClient.getAuthGeneration()) {
                    return
                }
                setReleases(res.releases ?? [])
                setPageIndex(0)
            })
            .catch((err) => {
                if (cancelled || authGeneration !== apiClient.getAuthGeneration()) {
                    return
                }
                setError(err instanceof Error ? err.message : String(err))
            })
            .finally(() => {
                if (!cancelled && authGeneration === apiClient.getAuthGeneration()) {
                    setLoading(false)
                }
            })

        return () => {
            cancelled = true
        }
    }, [authGeneration, open, target])

    // Flat sorted list of all non-draft releases (newest first)
    const sortedReleases = useMemo(() => {
        const nonDraft = releases.filter((r) => !r.draft)
        nonDraft.sort((a, b) => {
            const pa = parseVersion(a.tag_name)
            const pb = parseVersion(b.tag_name)
            if (!pa || !pb) {
                return 0
            }
            return -compareSemver(pa, pb)
        })
        return nonDraft
    }, [releases])

    const totalPages    = Math.max(1, Math.ceil(sortedReleases.length / PAGE_SIZE))
    const pageReleases  = sortedReleases.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE)
    const totalReleases = sortedReleases.length

    const currentParsed = useMemo(() => parseVersion(currentVersion), [currentVersion])

    const isCurrentVersion = useCallback(
        (tag: string) => {
            if (!currentParsed) {
                return false
            }
            const parsed = parseVersion(tag)
            if (!parsed) {
                return false
            }
            return compareSemver(parsed, currentParsed) === 0
        },
        [currentParsed],
    )

    /** 开发构建可安装正式版本，不据此判断版本高低 */
    const getUpdateDirection = useCallback(
        (tag: string): 'upgrade' | 'downgrade' | 'install' | null => {
            const parsed = parseVersion(tag)
            if (!parsed) {
                return null
            }
            if (!currentParsed) {
                return currentVersion.trim().toLowerCase() === 'dev' ? 'install' : null
            }
            const cmp = compareSemver(currentParsed, parsed)
            if (cmp < 0) {
                return 'upgrade'
            }
            if (cmp > 0) {
                return 'downgrade'
            }
            return null
        },
        [currentParsed, currentVersion],
    )

    const isNonOfficial = useMemo(() => {
        if (!repository) {
            return false
        }
        const normalized = repository.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '')
        return normalized !== OFFICIAL_REPOSITORIES[target] && normalized !== ''
    }, [repository, target])

    const targetLabel = t(`version_history.target_${target}`, {
        defaultValue: target === 'panel' ? 'Panel' : 'CPA backend',
    })

    const isUpdating =
              updateStatus?.status === 'downloading' ||
              updateStatus?.status === 'verifying' ||
              updateStatus?.status === 'draining' ||
              updateStatus?.status === 'replacing'

    useEffect(() => {
        if (!open || target !== 'cpa' || !pollingReady) {
            return
        }

        const controller = new AbortController()
        const expectedAttemptID = updateStatus?.attempt_id
        const expectedVersion = updateStatus?.target_version ?? updatingVersion
        let timer: ReturnType<typeof setTimeout> | null = null
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null
        let active = true

        const poll = async () => {
            if (authGeneration !== apiClient.getAuthGeneration()) {
                return
            }
            try {
                const status = await updateApi.status({signal: controller.signal, attemptID: expectedAttemptID})
                if (!active || controller.signal.aborted || authGeneration !== apiClient.getAuthGeneration()) {
                    return
                }
                if (expectedAttemptID && (status.attempt_id !== expectedAttemptID ||
                    status.target_version !== expectedVersion || status.status === 'idle' || status.state_available === false)) {
                    throw new Error(t('version_history.status_attempt_unconfirmed'))
                }
                if (reconnectTimer !== null) {
                    clearTimeout(reconnectTimer)
                    reconnectTimer = null
                }
                setPollError(null)
                setUpdateStatus(status)
                if (status.status === 'done') {
                    try {
                        await refreshServerVersion()
                    } catch (err) {
                        if (active && !controller.signal.aborted && authGeneration === apiClient.getAuthGeneration()) {
                            showNotification(t('version_history.status_version_refresh_failed', {
                                error: err instanceof Error ? err.message : String(err),
                            }), 'error')
                        }
                    }
                    if (!active || controller.signal.aborted || authGeneration !== apiClient.getAuthGeneration()) {
                        return
                    }
                }
                if (status.status === 'done' || status.status === 'error' || status.status === 'idle') {
                    setPollingReady(false)
                    setUpdatingVersion(null)
                    if (updatingVersion && status.status === 'done') {
                        showNotification(status.message, 'success')
                    } else if (updatingVersion && status.status === 'error') {
                        showNotification(status.message, 'error')
                    }
                    return
                }
            } catch (err: unknown) {
                if (!active || controller.signal.aborted || authGeneration !== apiClient.getAuthGeneration()) {
                    return
                }
                setPollError(err instanceof Error ? err.message : String(err))
                if (err instanceof Error && 'status' in err && (err.status === 401 || err.status === 403)) {
                    setPollingReady(false)
                    return
                }
                if (reconnectTimer === null) {
                    reconnectTimer = setTimeout(() => {
                        if (!active || authGeneration !== apiClient.getAuthGeneration()) {
                            return
                        }
                        setPollingReady(false)
                        controller.abort()
                        if (timer !== null) {
                            clearTimeout(timer)
                        }
                    }, UPDATE_POLL_RECONNECT_TIMEOUT)
                }
            }
            timer = setTimeout(() => {
                void poll()
            }, UPDATE_POLL_INTERVAL)
        }

        timer = setTimeout(() => {
            void poll()
        }, UPDATE_POLL_INTERVAL)

        return () => {
            active = false
            controller.abort()
            if (timer !== null) {
                clearTimeout(timer)
            }
            if (reconnectTimer !== null) {
                clearTimeout(reconnectTimer)
            }
        }
    }, [authGeneration, open, pollingReady, refreshServerVersion, showNotification, t, target, updateStatus?.attempt_id, updateStatus?.target_version, updatingVersion])

    const handleUpdate = async (tag: string) => {
        const submittedView = viewGeneration.current
        const isCurrent = () => open && submittedView === viewGeneration.current && authGeneration === apiClient.getAuthGeneration()
        const direction = getUpdateDirection(tag)
        if (!direction || checkingVersion || isUpdating || pollingReady || pollError || !isCurrent()) {
            return
        }

        setCheckingVersion(tag)
        try {
            const isDowngrade       = direction === 'downgrade'
            const release           = releases.find((item) => item.tag_name === tag)
            const breakingHints     = isDowngrade ? collectBreakingBetween(releases, currentVersion, tag) : []
            const compatibilityTips = release ? extractCompatibilityHints(release.body) : []
            const currentPanel      = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : currentVersion

            let compatibility: UpdateCompatibility | null = null
            let requiredServerVersion: string | null      = null
            let serverVersionForCheck: string | null      = serverVersion || null
            const compatibilityMessages: string[]         = []
            let confirmDisabled                           = false

            if (target === 'cpa') {
                compatibility   = await updateApi.compatibility(tag)
                confirmDisabled = !compatibility.compatible
                compatibilityMessages.push(
                    compatibility.compatible
                    ? t('version_history.confirm_compatibility_ok')
                    : t('version_history.confirm_compatibility_blocked'),
                )
                compatibilityMessages.push(...(compatibility.warnings ?? []))
            } else {
                requiredServerVersion = release ? extractRequiredServerVersion(release.body) : null
                if (requiredServerVersion) {
                    try {
                        await refreshServerVersion()
                        serverVersionForCheck = useAuthStore.getState().serverVersion || serverVersionForCheck
                    } catch {
                        serverVersionForCheck = useAuthStore.getState().serverVersion || serverVersionForCheck
                    }
                    const serverCompare = compareVersionStrings(serverVersionForCheck, requiredServerVersion)
                    if (serverCompare !== null && serverCompare < 0) {
                        confirmDisabled = true
                        compatibilityMessages.push(t('version_history.confirm_compatibility_blocked'))
                    } else if (serverCompare !== null) {
                        compatibilityMessages.push(t('version_history.confirm_compatibility_ok'))
                    } else {
                        compatibilityMessages.push(t('version_history.confirm_compatibility_unknown'))
                    }
                }
            }

            if (!isCurrent()) {
                return
            }

            const rows = [
                { label: t('version_history.confirm_target_version'), value: tag },
                {
                    label: t('version_history.confirm_published_at'),
                    value: release?.published_at ? formatDate(release.published_at, i18n.language) : '-',
                },
                {
                    label: t('version_history.confirm_impact'),
                    value: t(target === 'panel'
                             ? 'version_history.confirm_panel_impact'
                             : 'version_history.confirm_backend_impact'),
                },
                ...(target === 'panel'
                    ? [
                        {
                            label: t('version_history.confirm_current_server'),
                            value: serverVersionForCheck || '-',
                        },
                        {
                            label: t('version_history.confirm_required_server'),
                            value: requiredServerVersion || '-',
                        },
                    ]
                    : [
                        {
                            label: t('version_history.confirm_current_panel'),
                            value: currentPanel,
                        },
                        {
                            label: t('version_history.confirm_required_panel'),
                            value: compatibility?.min_panel_version || '-',
                        },
                    ]),
            ]

            const confirmTitle = t(`version_history.confirm_${direction}_target`, {
                version: tag,
                target: targetLabel,
            })

            showConfirmation({
                                 title: t(`version_history.${direction}`),
                                 message: (
                                     <div className={styles.updateConfirm}>
                                         <p className={styles.confirmIntro}>{confirmTitle}</p>
                                         {direction === 'install' && (
                                             <div className={`${styles.confirmNotice} ${styles.confirmWarning}`}>
                                                 {t('version_history.confirm_development_version', {
                                                     version: currentVersion,
                                                 })}
                                             </div>
                                         )}
                                         <div className={styles.confirmRows}>
                                             {rows.map((row) => (
                                                 <div key={row.label} className={styles.confirmRow}>
                                                     <span className={styles.confirmLabel}>{row.label}</span>
                                                     <span className={styles.confirmValue}>{row.value}</span>
                                                 </div>
                                             ))}
                                         </div>
                                         {target === 'cpa' && compatibility?.requires_restart && (
                                             <div className={`${styles.confirmNotice} ${styles.confirmWarning}`}>
                                                 {t('version_history.confirm_requires_restart')}
                                             </div>
                                         )}
                                         {compatibilityMessages.length > 0 && (
                                             <div
                                                 className={`${styles.confirmNotice} ${
                                                     confirmDisabled ? styles.confirmDanger : styles.confirmInfo
                                                 }`}
                                             >
                                                 <div className={styles.confirmNoticeTitle}>
                                                     {t('version_history.confirm_compatibility')}
                                                 </div>
                                                 <ul className={styles.confirmList}>
                                                     {compatibilityMessages.map((item, idx) => (
                                                         <li key={idx}>{item}</li>
                                                     ))}
                                                 </ul>
                                             </div>
                                         )}
                                         {compatibilityTips.length > 0 && (
                                             <div className={`${styles.confirmNotice} ${styles.confirmWarning}`}>
                                                 <div className={styles.confirmNoticeTitle}>
                                                     {t('version_history.confirm_release_notes')}
                                                 </div>
                                                 <ul className={styles.confirmList}>
                                                     {compatibilityTips.map((item, idx) => (
                                                         <li key={idx}>{item}</li>
                                                     ))}
                                                 </ul>
                                             </div>
                                         )}
                                         {breakingHints.length > 0 && (
                                             <div className={`${styles.confirmNotice} ${styles.confirmDanger}`}>
                                                 <div className={styles.confirmNoticeTitle}>
                                                     {t('version_history.downgrade_risk')}
                                                 </div>
                                                 <ul className={styles.confirmList}>
                                                     {breakingHints.slice(0, 5).map((item, idx) => (
                                                         <li key={idx}>{cleanReleaseLine(item)}</li>
                                                     ))}
                                                 </ul>
                                             </div>
                                         )}
                                     </div>
                                 ),
                                 variant: isDowngrade ? 'danger' : 'primary',
                                 confirmDisabled,
                                 confirmText: t(`version_history.confirm_${direction}_to`, {version: tag}),
                                 onConfirm: async () => {
                                     if (!isCurrent()) {
                                         return
                                     }
                                     const attemptID = crypto.randomUUID().replace(/-/g, '')
                                     setUpdatingVersion(tag)
                                     setPollingReady(false)
                                     setPollError(null)
                                     setUpdateStatus({
                                                         status: 'downloading',
                                                         message: '',
                                                         target_version: tag,
                                                         percent: 0,
                                                         current_version: currentVersion,
                                                         attempt_id: attemptID,
                                                     })
                                     try {
                                         if (target === 'panel') {
                                             await updateApi.panelUpdate(tag)
                                             if (!isCurrent()) {
                                                 return
                                             }
                                             setUpdatingVersion(null)
                                             setUpdateStatus({
                                                                 status: 'done',
                                                                 message: t(
                                                                     'version_switcher.panel_updated',
                                                                     { version: tag },
                                                                 ),
                                                                 target_version: tag,
                                                                 percent: 100,
                                                                 current_version: currentVersion,
                                                             })
                                             showNotification(
                                                 t('version_switcher.panel_updated', { version: tag }),
                                                 'success',
                                             )
                                             return
                                         }
                                         const result = await updateApi.trigger(tag, attemptID)
                                         if (!isCurrent()) {
                                             return
                                         }
                                         if (result.attempt_id !== attemptID || result.target_version !== tag) {
                                             throw new Error(t('version_history.status_attempt_unconfirmed'))
                                         }
                                         setPollingReady(true)
                                     } catch (err) {
                                         if (!isCurrent()) {
                                             return
                                         }
                                         const msg = err instanceof Error ? err.message : String(err)
                                         const status = err instanceof Error && 'status' in err ? err.status : undefined
                                         const explicitlyRejected = typeof status === 'number' && status >= 400 && status < 500 &&
                                                                    ![408, 425, 429].includes(status)
                                         if (target === 'cpa' && !explicitlyRejected) {
                                             setPollError(msg)
                                             setPollingReady(true)
                                             return
                                         }
                                         setPollingReady(false)
                                         setUpdatingVersion(null)
                                         setUpdateStatus({
                                                             status: 'error',
                                                             message: msg,
                                                             target_version: tag,
                                                             percent: 0,
                                                             current_version: currentVersion,
                                                         })
                                         showNotification(msg, 'error')
                                     }
                                 },
                             })
        } catch (err) {
            if (isCurrent()) {
                const msg = err instanceof Error ? err.message : String(err)
                showNotification(msg, 'error')
            }
        } finally {
            if (isCurrent()) {
                setCheckingVersion(null)
            }
        }
    }

    const goPage = (delta: number) => {
        setPageIndex((prev) => Math.max(0, Math.min(totalPages - 1, prev + delta)))
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={t('version_history.title_target', {
                target: targetLabel,
                defaultValue: `${targetLabel} history`,
            })}
            width='min(1120px, calc(100vw - 48px))'
            className={styles.historyModal}
        >
            {isNonOfficial && (
                <div className={styles.unofficialWarning}>
                    {t('version_history.unofficial_warning', { repo: repository })}
                </div>
            )}

            {/* Update progress bar */}
            {((updateStatus && updateStatus.status !== 'idle') || pollError) && (
                <div
                    role='status'
                    className={`${styles.updateBanner} ${
                        updateStatus?.status === 'error'
                        ? styles.updateError
                        : updateStatus?.status === 'done'
                          ? styles.updateDone
                          : ''
                    }`}
                >
                    <div className={styles.updateInfo}>
                        <span className={styles.updateLabel}>
                            {pollError
                             ? t(pollingReady ? 'version_history.status_reconnecting' : 'version_history.status_unconfirmed')
                             : t(`version_history.status_${updateStatus?.status}`)}
                        </span>
                        {pollError
                         ? <span className={styles.updateMessage}>
                             {t(pollingReady ? 'version_history.status_poll_reconnecting' : 'version_history.status_poll_failed')}: {pollError}
                         </span>
                         : updateStatus?.message && <span className={styles.updateMessage}>{updateStatus.message}</span>}
                        {pollError && !pollingReady && (
                            <Button variant='secondary' size='sm' onClick={() => setPollingReady(true)}>
                                {t('version_history.status_poll_retry')}
                            </Button>
                        )}
                    </div>
                    {isUpdating && !pollError && (
                        <div className={styles.progressBar}>
                            <div className={styles.progressFill} style={{ width: `${updateStatus?.percent}%` }} />
                        </div>
                    )}
                </div>
            )}

            {loading && <div className={styles.status}>{t('common.loading')}</div>}
            {error && <div className={styles.status}>{error}</div>}

            {!loading && !error && totalReleases === 0 && (
                <div className={styles.status}>{t('version_history.empty')}</div>
            )}

            {!loading && totalReleases > 0 && (
                <>
                    <div className={styles.listHeader}>
                        <span className={styles.listCount}>
                            {t('version_history.total_releases', { count: totalReleases })}
                        </span>
                    </div>

                    <div className={styles.releaseList}>
                        {pageReleases.map((release) => {
                            const isCurrent      = isCurrentVersion(release.tag_name)
                            const breaking       = extractBreakingHints(release.body)
                            const isPrerelease   = release.prerelease
                            const direction      = getUpdateDirection(release.tag_name)
                            const isThisUpdating = updatingVersion === release.tag_name && isUpdating
                            const isChecking     = checkingVersion === release.tag_name
                            const releaseURL     = safeExternalUrl(release.html_url)

                            return (
                                <div
                                    key={release.tag_name}
                                    className={`${styles.releaseItem} ${isCurrent ? styles.currentRelease : ''}`}
                                >
                                    <div className={styles.releaseHeader}>
                                        <span className={styles.releaseTag}>{release.tag_name}</span>
                                        {isCurrent && (
                                            <span className={styles.currentBadge}>{t('version_history.current')}</span>
                                        )}
                                        {!isCurrent && direction === 'upgrade' && (
                                            <span className={styles.upgradeBadge}>{t('version_history.upgrade')}</span>
                                        )}
                                        {!isCurrent && direction === 'downgrade' && (
                                            <span className={styles.downgradeBadge}>
                                                {t('version_history.downgrade')}
                                            </span>
                                        )}
                                        {isPrerelease && (
                                            <span className={styles.prereleaseBadge}>
                                                {t('version_history.prerelease')}
                                            </span>
                                        )}
                                        {breaking.length > 0 && (
                                            <span className={styles.breakingBadge}>
                                                {t('version_history.breaking_changes')}
                                            </span>
                                        )}
                                        <span className={styles.releaseDate}>
                                            {formatDate(release.published_at, i18n.language)}
                                        </span>
                                    </div>

                                    {release.name && release.name !== release.tag_name && (
                                        <div className={styles.releaseName}>{release.name}</div>
                                    )}

                                    {release.body &&
                                     (() => {
                                         const sections      = classifyReleaseBody(release.body)
                                         const hasStructured =
                                                   sections.features.length >
                                                   0 ||
                                                   sections.fixes.length >
                                                   0 ||
                                                   sections.other.length >
                                                   0
                                         if (hasStructured) {
                                             return (
                                                 <div className={styles.releaseSections}>
                                                     {sections.features.length > 0 && (
                                                         <div className={styles.releaseColumn}>
                                                             <div className={styles.columnTitle}>
                                                                 {t('version_history.section_features', {
                                                                     defaultValue: 'Features',
                                                                 })}
                                                             </div>
                                                             <ul className={styles.columnList}>
                                                                 {sections.features.map((item, idx) => (
                                                                     <li key={`feat-${idx}`}>{item}</li>
                                                                 ))}
                                                             </ul>
                                                         </div>
                                                     )}
                                                     {sections.fixes.length > 0 && (
                                                         <div className={styles.releaseColumn}>
                                                             <div className={styles.columnTitle}>
                                                                 {t('version_history.section_fixes', {
                                                                     defaultValue: 'Fixes',
                                                                 })}
                                                             </div>
                                                             <ul className={styles.columnList}>
                                                                 {sections.fixes.map((item, idx) => (
                                                                     <li key={`fix-${idx}`}>{item}</li>
                                                                 ))}
                                                             </ul>
                                                         </div>
                                                     )}
                                                     {sections.other.length > 0 && (
                                                         <div className={styles.releaseColumn}>
                                                             <div className={styles.columnTitle}>
                                                                 {t('version_history.section_other', {
                                                                     defaultValue: 'Details',
                                                                 })}
                                                             </div>
                                                             <ul className={styles.columnList}>
                                                                 {sections.other.map((item, idx) => (
                                                                     <li key={`other-${idx}`}>{item}</li>
                                                                 ))}
                                                             </ul>
                                                         </div>
                                                     )}
                                                 </div>
                                             )
                                         }
                                         return <div className={styles.releaseBody}>{release.body}</div>
                                     })()}

                                    {breaking.length > 0 && (
                                        <div className={styles.breakingSection}>
                                            <div className={styles.breakingTitle}>
                                                {t('version_history.breaking_changes')}
                                            </div>
                                            {breaking.map((hint, idx) => (
                                                <div key={idx} className={styles.breakingHint}>
                                                    {hint}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <div className={styles.releaseActions}>
                                        {releaseURL && (
                                            <a
                                                href={releaseURL}
                                                target='_blank'
                                                rel='noopener noreferrer'
                                                className={styles.ghLink}
                                            >
                                                GitHub <IconExternalLink size={12} />
                                            </a>
                                        )}
                                        {direction && (
                                            <Button
                                                variant={direction === 'downgrade' ? 'danger' : 'primary'}
                                                size='sm'
                                                disabled={isUpdating || pollingReady || Boolean(pollError) || Boolean(checkingVersion)}
                                                loading={isThisUpdating || isChecking}
                                                onClick={() => handleUpdate(release.tag_name)}
                                            >
                                                <IconDownload size={13} />
                                                {t(`version_history.${direction}`)}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className={styles.pager}>
                            <Button variant='secondary' size='sm' disabled={pageIndex <= 0} onClick={() => goPage(-1)}>
                                <IconChevronLeft size={14} />
                            </Button>
                            <div className={styles.pagerInfo}>
                                {pageIndex + 1} / {totalPages}
                            </div>
                            <Button
                                variant='secondary'
                                size='sm'
                                disabled={pageIndex >= totalPages - 1}
                                onClick={() => goPage(1)}
                            >
                                <IconChevronLeft size={14} style={{ transform: 'rotate(180deg)' }} />
                            </Button>
                        </div>
                    )}
                </>
            )}
        </Modal>
    )
}
