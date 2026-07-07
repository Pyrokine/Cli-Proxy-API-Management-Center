import {Button} from '@/components/ui/Button'
import {IconChevronLeft, IconDownload, IconExternalLink} from '@/components/ui/icons'
import {Modal} from '@/components/ui/Modal'
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
const COMPATIBILITY_PATTERN                                 = /\b(?:required|requires|compatib|breaking|migration|migrate|incompatible)\b|要求|兼容|相容|不兼容|迁移|遷移|⚠/i
const UPDATE_POLL_INTERVAL                                  = 2000
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
        .match(/^(?<major>\d+)\.(?<minor>\d+)(?:\.(?<patch>\d+))?(?:-(?:aug|augmented)\.(?<aug>\d+))?$/i)
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
    return lines.filter((line) => BREAKING_PATTERN.test(line)).map((l) => l.trim())
}

/** Classify a release body line into features / fixes / other for side-by-side display. */
interface ReleaseSections {
    features: string[]
    fixes: string[]
    other: string[]
}

const FEATURE_SECTION_PATTERN = /^(?:#+\s*)?(?:features?|enhancements?|新增|特性|功能|added|new|what's changed|whats changed|更新内容|变更)\b/i
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

    const [releases, setReleases]   = useState<Release[]>([])
    const [loading, setLoading]     = useState(false)
    const [error, setError]         = useState<string | null>(null)
    const [pageIndex, setPageIndex] = useState(0)

    // Update progress
    const [updateStatus, setUpdateStatus]       = useState<UpdateStatus | null>(null)
    const [updatingVersion, setUpdatingVersion] = useState<string | null>(null)
    const [checkingVersion, setCheckingVersion] = useState<string | null>(null)
    const pollTimerRef                          = useRef<ReturnType<typeof setInterval> | null>(null)

    // Fetch releases when modal opens
    const [prevOpen, setPrevOpen] = useState(false)
    if (open && !prevOpen) {
        setPrevOpen(true)
        setLoading(true)
        setError(null)
    }
    if (!open && prevOpen) {
        setPrevOpen(false)
    }

    useEffect(() => {
        if (!open) {
            return
        }
        let cancelled = false

        releasesApi
            .list(1, 100, target)
            .then((res) => {
                if (cancelled) {
                    return
                }
                setReleases(res.releases ?? [])
                setPageIndex(0)
            })
            .catch((err) => {
                if (cancelled) {
                    return
                }
                setError(err instanceof Error ? err.message : String(err))
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false)
                }
            })

        return () => {
            cancelled = true
        }
    }, [open, target])

    // Clean up poll timer when modal closes
    useEffect(() => {
        if (!open && pollTimerRef.current) {
            clearInterval(pollTimerRef.current)
            pollTimerRef.current = null
        }
    }, [open])

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

    /** Returns 'upgrade' | 'downgrade' | null */
    const getUpdateDirection = useCallback(
        (tag: string): 'upgrade' | 'downgrade' | null => {
            if (!currentParsed) {
                return null
            }
            const parsed = parseVersion(tag)
            if (!parsed) {
                return null
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
        [currentParsed],
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
              updateStatus?.status === 'replacing'

    const startPolling = () => {
        if (pollTimerRef.current) {
            return
        }
        pollTimerRef.current = setInterval(async () => {
            try {
                const status = target === 'panel' ? null : await updateApi.status()
                if (!status) {
                    return
                }
                setUpdateStatus(status)
                if (status.status === 'done' || status.status === 'error' || status.status === 'idle') {
                    if (pollTimerRef.current) {
                        clearInterval(pollTimerRef.current)
                        pollTimerRef.current = null
                    }
                    if (status.status === 'done') {
                        showNotification(status.message, 'success')
                    } else if (status.status === 'error') {
                        showNotification(status.message, 'error')
                    }
                }
            } catch {
                // Ignore poll errors
            }
        }, UPDATE_POLL_INTERVAL)
    }

    const handleUpdate = async (tag: string) => {
        const direction = getUpdateDirection(tag)
        if (!direction || checkingVersion) {
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

            const confirmTitle = t(isDowngrade
                                   ? 'version_history.confirm_downgrade_target'
                                   : 'version_history.confirm_upgrade_target', {
                                       version: tag,
                                       target: targetLabel,
                                   })

            showConfirmation({
                                 title: t(isDowngrade ? 'version_history.downgrade' : 'version_history.upgrade'),
                                 message: (
                                     <div className={styles.updateConfirm}>
                                         <p className={styles.confirmIntro}>{confirmTitle}</p>
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
                                 confirmText: t(isDowngrade
                                                ? 'version_history.confirm_downgrade_to'
                                                : 'version_history.confirm_upgrade_to', { version: tag }),
                                 onConfirm: async () => {
                                     setUpdatingVersion(tag)
                                     setUpdateStatus({
                                                         status: 'downloading',
                                                         message: '',
                                                         target_version: tag,
                                                         percent: 0,
                                                         current_version: currentVersion,
                                                     })
                                     try {
                                         if (target === 'panel') {
                                             await updateApi.panelUpdate(tag)
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
                                         await updateApi.trigger(tag)
                                         startPolling()
                                     } catch (err) {
                                         const msg = err instanceof Error ? err.message : String(err)
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
            const msg = err instanceof Error ? err.message : String(err)
            showNotification(msg, 'error')
        } finally {
            setCheckingVersion(null)
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
            {updateStatus && updateStatus.status !== 'idle' && (
                <div
                    className={`${styles.updateBanner} ${
                        updateStatus.status === 'error'
                        ? styles.updateError
                        : updateStatus.status === 'done'
                          ? styles.updateDone
                          : ''
                    }`}
                >
                    <div className={styles.updateInfo}>
                        <span className={styles.updateLabel}>{t(`version_history.status_${updateStatus.status}`)}</span>
                        {updateStatus.message && <span className={styles.updateMessage}>{updateStatus.message}</span>}
                    </div>
                    {isUpdating && (
                        <div className={styles.progressBar}>
                            <div className={styles.progressFill} style={{ width: `${updateStatus.percent}%` }} />
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
                                                disabled={isUpdating || Boolean(checkingVersion)}
                                                loading={isThisUpdating || isChecking}
                                                onClick={() => handleUpdate(release.tag_name)}
                                            >
                                                <IconDownload size={13} />
                                                {t(
                                                    direction === 'downgrade'
                                                    ? 'version_history.downgrade'
                                                    : 'version_history.upgrade',
                                                )}
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
