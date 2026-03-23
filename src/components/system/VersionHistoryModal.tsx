import {Button} from '@/components/ui/Button'
import {IconChevronLeft, IconDownload, IconExternalLink} from '@/components/ui/icons'
import {Modal} from '@/components/ui/Modal'
import type {Release} from '@/services/api/releases'
import {releasesApi} from '@/services/api/releases'
import type {UpdateStatus} from '@/services/api/update'
import {updateApi} from '@/services/api/update'
import {useNotificationStore} from '@/stores'
import {getEffectiveTimezone} from '@/stores/useTimezoneStore'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './VersionHistoryModal.module.scss'

/* ---------- constants ---------- */

const OFFICIAL_CPA_REPO    = 'Pyrokine/CLIProxyAPI'
const BREAKING_PATTERN     = /\b(?:breaking|migration|migrate|incompatible)\b|⚠/i
const UPDATE_POLL_INTERVAL = 2000

/* ---------- types ---------- */

interface VersionGroup {
    /** e.g. "1.3" */
    key: string;
    /** e.g. "v1.3" */
    label: string;
    releases: Release[];
}

interface VersionHistoryModalProps {
    open: boolean;
    onClose: () => void;
    currentVersion: string;
    cpaRepository?: string;
}

/* ---------- helpers ---------- */

/** Parse "v1.3.2" → { major: 1, minor: 3, patch: 2, groupKey: "1.3" } */
function parseVersion(tag: string) {
    const match = tag.replace(/^v/i, '').match(/^(?<major>\d+)\.(?<minor>\d+)(?:\.(?<patch>\d+))?/)
    if (!match?.groups) {
        return null
    }
    const major = Number(match.groups.major)
    const minor = Number(match.groups.minor)
    const patch = match.groups.patch !== undefined ? Number(match.groups.patch) : 0
    return { major, minor, patch, groupKey: `${major}.${minor}` }
}

/** Compare two semver tuples: returns negative if a < b, positive if a > b. */
function compareSemver(a: { major: number; minor: number; patch: number }, b: typeof a) {
    if (a.major !== b.major) {
        return a.major - b.major
    }
    if (a.minor !== b.minor) {
        return a.minor - b.minor
    }
    return a.patch - b.patch
}

/** Group releases by major/minor version, sorted newest first. */
function groupReleases(releases: Release[]): VersionGroup[] {
    const map                                                       = new Map<string, Release[]>()
    const keyOrder: { key: string; major: number; minor: number }[] = []

    for (const release of releases) {
        if (release.draft) {
            continue
        }
        const parsed = parseVersion(release.tag_name)
        if (!parsed) {
            continue
        }
        const { groupKey, major, minor } = parsed
        if (!map.has(groupKey)) {
            map.set(groupKey, [])
            keyOrder.push({ key: groupKey, major, minor })
        }
        map.get(groupKey)!.push(release)
    }

    // Sort groups newest first
    keyOrder.sort((a, b) => {
        if (a.major !== b.major) {
            return b.major - a.major
        }
        return b.minor - a.minor
    })

    // Sort releases inside each group newest first
    return keyOrder.map(({ key }) => {
        const items = map.get(key)!
        items.sort((a, b) => {
            const pa = parseVersion(a.tag_name)
            const pb = parseVersion(b.tag_name)
            if (!pa || !pb) {
                return 0
            }
            // Descending (newest first)
            return -compareSemver(pa, pb)
        })
        return { key, label: `v${key}`, releases: items }
    })
}

/** Check if a release body mentions breaking changes. */
function extractBreakingHints(body: string): string[] {
    if (!body) {
        return []
    }
    const lines = body.split('\n')
    return lines.filter((line) => BREAKING_PATTERN.test(line)).map((l) => l.trim())
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

/** Format ISO date to locale short date. */
function formatDate(iso: string, locale: string): string {
    try {
        const timeZone = getEffectiveTimezone()
        return new Date(iso).toLocaleDateString(locale, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            ...(timeZone ? { timeZone } : {}),
        })
    } catch {
        return iso
    }
}

/* ---------- component ---------- */

export function VersionHistoryModal({ open, onClose, currentVersion, cpaRepository }: VersionHistoryModalProps) {
    const { t, i18n }                            = useTranslation()
    const { showConfirmation, showNotification } = useNotificationStore()

    const [releases, setReleases]     = useState<Release[]>([])
    const [loading, setLoading]       = useState(false)
    const [error, setError]           = useState<string | null>(null)
    const [groupIndex, setGroupIndex] = useState(0)

    // Update progress
    const [updateStatus, setUpdateStatus]       = useState<UpdateStatus | null>(null)
    const [updatingVersion, setUpdatingVersion] = useState<string | null>(null)
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
            .list(1, 100)
            .then((res) => {
                if (cancelled) {
                    return
                }
                setReleases(res.releases ?? [])
                setGroupIndex(0)
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
    }, [open])

    // Clean up poll timer when modal closes
    useEffect(() => {
        if (!open && pollTimerRef.current) {
            clearInterval(pollTimerRef.current)
            pollTimerRef.current = null
        }
    }, [open])

    const groups      = useMemo(() => groupReleases(releases), [releases])
    const totalGroups = groups.length
    const activeGroup = groups[groupIndex] ?? null

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
            return (
                parsed.major === currentParsed.major &&
                parsed.minor === currentParsed.minor &&
                parsed.patch === currentParsed.patch
            )
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
        if (!cpaRepository) {
            return false
        }
        const normalized = cpaRepository.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '')
        return normalized !== OFFICIAL_CPA_REPO && normalized !== ''
    }, [cpaRepository])

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
                const status = await updateApi.status()
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

    const handleUpdate = (tag: string) => {
        const direction = getUpdateDirection(tag)
        if (!direction) {
            return
        }

        const isDowngrade   = direction === 'downgrade'
        const breakingHints = isDowngrade ? collectBreakingBetween(releases, currentVersion, tag) : []

        const messageLines = [
            t(isDowngrade ? 'version_history.confirm_downgrade' : 'version_history.confirm_upgrade', {
                version: tag,
            }),
        ]
        if (breakingHints.length > 0) {
            messageLines.push('', t('version_history.downgrade_risk'), ...breakingHints.slice(0, 5))
        }

        showConfirmation({
                             title: t(isDowngrade ? 'version_history.downgrade' : 'version_history.upgrade'),
                             message: messageLines.join('\n'),
                             variant: isDowngrade ? 'danger' : 'primary',
                             confirmText: t('common.confirm'),
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
    }

    const goPage = (delta: number) => {
        setGroupIndex((prev) => Math.max(0, Math.min(totalGroups - 1, prev + delta)))
    }

    return (
        <Modal open={open} onClose={onClose} title={t('version_history.title')} width={680}>
            {isNonOfficial && (
                <div className={styles.unofficialWarning}>
                    {t('version_history.unofficial_warning', { repo: cpaRepository })}
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

            {!loading &&
             !error &&
             totalGroups ===
             0 &&
             <div className={styles.status}>{t('version_history.empty')}</div>}

            {!loading && activeGroup && (
                <>
                    <div className={styles.groupCard}>
                        <div className={styles.groupHeader}>
                            <span className={styles.groupLabel}>{activeGroup.label}</span>
                            <span className={styles.groupCount}>
                {t('version_history.patch_count', { count: activeGroup.releases.length })}
              </span>
                        </div>

                        <div className={styles.releaseList}>
                            {activeGroup.releases.map((release) => {
                                const isCurrent      = isCurrentVersion(release.tag_name)
                                const breaking       = extractBreakingHints(release.body)
                                const isPrerelease   = release.prerelease
                                const direction      = getUpdateDirection(release.tag_name)
                                const isThisUpdating = updatingVersion === release.tag_name && isUpdating

                                return (
                                    <div
                                        key={release.tag_name}
                                        className={`${styles.releaseItem} ${isCurrent ? styles.currentRelease : ''}`}
                                    >
                                        <div className={styles.releaseHeader}>
                                            <span className={styles.releaseTag}>{release.tag_name}</span>
                                            {isCurrent &&
                                             <span
                                                 className={styles.currentBadge}>{t('version_history.current')}</span>}
                                            {isPrerelease && (
                                                <span
                                                    className={styles.prereleaseBadge}>{t('version_history.prerelease')}</span>
                                            )}
                                            <span className={styles.releaseDate}>{formatDate(
                                                release.published_at,
                                                i18n.language,
                                            )}</span>
                                        </div>

                                        {release.name && release.name !== release.tag_name && (
                                            <div className={styles.releaseName}>{release.name}</div>
                                        )}

                                        {release.body && (
                                            <div className={styles.releaseBody}>
                                                {release.body.length > 500 ?
                                                 release.body.slice(0, 500) + '...' :
                                                 release.body}
                                            </div>
                                        )}

                                        {breaking.length > 0 && (
                                            <div className={styles.breakingSection}>
                                                <div className={styles.breakingTitle}>{t(
                                                    'version_history.breaking_changes')}</div>
                                                {breaking.map((hint, idx) => (
                                                    <div key={idx} className={styles.breakingHint}>
                                                        {hint}
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <div className={styles.releaseActions}>
                                            <a href={release.html_url} target='_blank' rel='noopener noreferrer'
                                               className={styles.ghLink}>
                                                GitHub <IconExternalLink size={12} />
                                            </a>
                                            {direction && (
                                                <Button
                                                    variant={direction === 'downgrade' ? 'danger' : 'primary'}
                                                    size='sm'
                                                    disabled={isUpdating}
                                                    loading={isThisUpdating}
                                                    onClick={() => handleUpdate(release.tag_name)}
                                                >
                                                    <IconDownload size={13} />
                                                    {t(direction === 'downgrade' ?
                                                       'version_history.downgrade' :
                                                       'version_history.upgrade')}
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Pagination */}
                    {totalGroups > 1 && (
                        <div className={styles.pager}>
                            <Button variant='secondary' size='sm' disabled={groupIndex <= 0} onClick={() => goPage(-1)}>
                                <IconChevronLeft size={14} />
                            </Button>
                            <div className={styles.pagerInfo}>
                                {groupIndex + 1} / {totalGroups}
                            </div>
                            <Button variant='secondary' size='sm' disabled={groupIndex >= totalGroups - 1}
                                    onClick={() => goPage(1)}>
                                <IconChevronLeft size={14} style={{ transform: 'rotate(180deg)' }} />
                            </Button>
                        </div>
                    )}
                </>
            )}
        </Modal>
    )
}
