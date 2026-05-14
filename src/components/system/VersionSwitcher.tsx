import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import type { Release, ReleasesTarget } from '@/services/api/releases'
import { releasesApi } from '@/services/api/releases'
import type { UpdateCompatibility, UpdateStatus } from '@/services/api/update'
import { updateApi } from '@/services/api/update'
import { useNotificationStore } from '@/stores'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './VersionSwitcher.module.scss'

const POLL_INTERVAL_MS = 2000
const BREAKING_PATTERN = /\b(?:breaking|migration|migrate|incompatible)\b|⚠/i

interface VersionSwitcherProps {
    target: ReleasesTarget
    currentVersion: string
    onAfterSwitch?: () => void
}

function formatBytes(size: number): string {
    if (!Number.isFinite(size) || size <= 0) {
        return '0 B'
    }
    const units = ['B', 'KB', 'MB', 'GB']
    let value = size
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024
        unitIndex++
    }
    return `${value >= 100 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function parseSemver(tag: string): [number, number, number, number] | null {
    const m = tag.replace(/^v/i, '').match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:-aug\.(\d+))?(?:-.+)?$/i)
    if (!m) {
        return null
    }
    return [Number(m[1]), Number(m[2]), m[3] !== undefined ? Number(m[3]) : 0, m[4] !== undefined ? Number(m[4]) : 0]
}

function compareSemverTag(a: string, b: string): number {
    const pa = parseSemver(a)
    const pb = parseSemver(b)
    if (!pa || !pb) {
        return 0
    }
    for (let i = 0; i < 4; i++) {
        if (pa[i] !== pb[i]) {
            return pa[i] - pb[i]
        }
    }
    return 0
}

function isSameReleaseTag(a: string, b: string): boolean {
    if (!a || !b) {
        return false
    }
    const parsedA = parseSemver(a)
    const parsedB = parseSemver(b)
    if (parsedA && parsedB) {
        return parsedA.every((segment, index) => segment === parsedB[index])
    }
    const normalizedA = a
        .trim()
        .replace(/^v/i, '')
        .replace(/-dirty$/i, '')
    const normalizedB = b
        .trim()
        .replace(/^v/i, '')
        .replace(/-dirty$/i, '')
    if (!normalizedA || !normalizedB) {
        return false
    }
    return normalizedA === normalizedB
}

function extractBreakingHints(body: string): string[] {
    if (!body) {
        return []
    }
    return body
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => BREAKING_PATTERN.test(line))
}

function collectBreakingBetween(releases: Release[], currentTag: string, targetTag: string): string[] {
    const current = parseSemver(currentTag)
    const target = parseSemver(targetTag)
    if (!current || !target || compareSemverTag(currentTag, targetTag) <= 0) {
        return []
    }

    const hints: string[] = []
    for (const release of releases) {
        const parsed = parseSemver(release.tag_name)
        if (!parsed) {
            continue
        }
        if (compareSemverTag(release.tag_name, targetTag) > 0 && compareSemverTag(release.tag_name, currentTag) <= 0) {
            hints.push(...extractBreakingHints(release.body))
        }
    }
    return hints
}

export function VersionSwitcher({ target, currentVersion, onAfterSwitch }: VersionSwitcherProps) {
    const { t } = useTranslation()
    const { showConfirmation, showNotification } = useNotificationStore()

    const [releases, setReleases] = useState<Release[]>([])
    const [selected, setSelected] = useState<string>('')
    const [loadingList, setLoadingList] = useState(true)
    const [pending, setPending] = useState(false)
    const [compatibility, setCompatibility] = useState<UpdateCompatibility | null>(null)
    const [compatibilityLoading, setCompatibilityLoading] = useState(false)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        let cancelled = false
        releasesApi
            .list(1, 100, target)
            .then((res) => {
                if (cancelled) {
                    return
                }
                const list = (res.releases ?? []).filter((r) => !r.draft)
                list.sort((a, b) => -compareSemverTag(a.tag_name, b.tag_name))
                setReleases(list)
                setSelected((prev) => {
                    if (prev && list.some((release) => isSameReleaseTag(release.tag_name, prev))) {
                        return list.find((release) => isSameReleaseTag(release.tag_name, prev))?.tag_name || prev
                    }
                    if (currentVersion && list.some((release) => isSameReleaseTag(release.tag_name, currentVersion))) {
                        return (
                            list.find((release) => isSameReleaseTag(release.tag_name, currentVersion))?.tag_name ||
                            currentVersion
                        )
                    }
                    return list[0]?.tag_name || ''
                })
            })
            .catch((err) => {
                if (!cancelled) {
                    showNotification(err instanceof Error ? err.message : String(err), 'error')
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadingList(false)
                }
            })
        return () => {
            cancelled = true
        }
    }, [target, currentVersion, showNotification])

    useEffect(
        () => () => {
            if (pollRef.current) {
                clearInterval(pollRef.current)
                pollRef.current = null
            }
        },
        []
    )

    const shouldLoadCompatibility = target === 'cpa' && !!selected && !isSameReleaseTag(selected, currentVersion)

    useEffect(() => {
        if (!shouldLoadCompatibility) {
            return
        }
        let cancelled = false
        queueMicrotask(() => {
            if (cancelled) {
                return
            }
            setCompatibilityLoading(true)
            updateApi
                .compatibility(selected)
                .then((response) => {
                    if (!cancelled) {
                        setCompatibility(response)
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setCompatibility(null)
                    }
                })
                .finally(() => {
                    if (!cancelled) {
                        setCompatibilityLoading(false)
                    }
                })
        })
        return () => {
            cancelled = true
        }
    }, [selected, shouldLoadCompatibility])

    const activeCompatibility = useMemo(() => {
        if (!shouldLoadCompatibility || !compatibility || compatibility.target_version !== selected) {
            return null
        }
        return compatibility
    }, [compatibility, selected, shouldLoadCompatibility])

    const direction = useMemo<'same' | 'upgrade' | 'downgrade'>(() => {
        if (!selected) {
            return 'same'
        }
        const selectedVersion = parseSemver(selected)
        const currentParsed = parseSemver(currentVersion)
        if (!selectedVersion) {
            return 'same'
        }
        if (!currentParsed) {
            return 'upgrade'
        }
        const cmp = compareSemverTag(selected, currentVersion)
        if (cmp > 0) {
            return 'upgrade'
        }
        if (cmp < 0) {
            return 'downgrade'
        }
        return 'same'
    }, [selected, currentVersion])

    const startPollingCPA = useCallback(() => {
        if (pollRef.current) {
            return
        }
        pollRef.current = setInterval(async () => {
            try {
                const status: UpdateStatus = await updateApi.status()
                if (status.status === 'done') {
                    setPending(false)
                    showNotification(status.message || t('version_switcher.success'), 'success')
                    if (pollRef.current) {
                        clearInterval(pollRef.current)
                        pollRef.current = null
                    }
                    onAfterSwitch?.()
                } else if (status.status === 'error') {
                    setPending(false)
                    showNotification(status.message || t('version_switcher.failed'), 'error')
                    if (pollRef.current) {
                        clearInterval(pollRef.current)
                        pollRef.current = null
                    }
                }
            } catch {
                // transient poll errors are ignored; user can retry
            }
        }, POLL_INTERVAL_MS)
    }, [onAfterSwitch, showNotification, t])

    const handleSwitch = useCallback(async () => {
        if (!selected || direction === 'same') {
            return
        }

        const targetLabel = t(`version_history.target_${target}`, {
            defaultValue: target === 'panel' ? 'Panel' : 'CPA backend',
        })
        const isDowngrade = direction === 'downgrade'
        const breakingHints = isDowngrade ? collectBreakingBetween(releases, currentVersion, selected) : []
        const messageLines = [
            t(isDowngrade ? 'version_history.confirm_downgrade_target' : 'version_history.confirm_upgrade_target', {
                version: selected,
                target: targetLabel,
            }),
            '',
            t(target === 'panel' ? 'version_switcher.confirm_risk_panel' : 'version_switcher.confirm_risk_cpa'),
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
                setPending(true)
                try {
                    if (target === 'cpa') {
                        const latestCompatibility = activeCompatibility ?? (await updateApi.compatibility(selected))
                        setCompatibility(latestCompatibility)
                        if (!latestCompatibility.compatible) {
                            const warningLines = latestCompatibility.warnings?.length
                                ? latestCompatibility.warnings
                                : [t('version_switcher.compatibility_blocked')]
                            showNotification(warningLines.join(' | '), 'error')
                            setPending(false)
                            return
                        }
                        await updateApi.trigger(selected)
                        startPollingCPA()
                    } else {
                        await updateApi.panelUpdate(selected)
                        setPending(false)
                        showNotification(t('version_switcher.panel_updated', { version: selected }), 'success')
                        onAfterSwitch?.()
                    }
                } catch (err) {
                    setPending(false)
                    showNotification(err instanceof Error ? err.message : String(err), 'error')
                }
            },
        })
    }, [
        activeCompatibility,
        currentVersion,
        direction,
        onAfterSwitch,
        releases,
        selected,
        showConfirmation,
        showNotification,
        startPollingCPA,
        t,
        target,
    ])

    const buttonLabel = useMemo(() => {
        if (direction === 'downgrade') {
            return t('version_switcher.rollback_to', { version: selected })
        }
        if (direction === 'upgrade') {
            return t('version_switcher.upgrade_to', { version: selected })
        }
        return t('version_switcher.current_version')
    }, [direction, selected, t])

    return (
        <div className={styles.root}>
            <div className={styles.row}>
                <span className={styles.label}>{t('version_switcher.target_label')}</span>
                <Select
                    className={styles.select}
                    value={selected}
                    onChange={setSelected}
                    disabled={loadingList || pending || releases.length === 0}
                    fullWidth={false}
                    options={
                        releases.length === 0
                            ? [{ value: '', label: t('version_switcher.no_versions') }]
                            : releases.map((r) => ({
                                  value: r.tag_name,
                                  label: isSameReleaseTag(r.tag_name, currentVersion)
                                      ? `${r.tag_name} (${t('version_switcher.current_marker')})`
                                      : r.tag_name,
                              }))
                    }
                    placeholder={t('version_switcher.no_versions')}
                />
                {direction !== 'same' && (
                    <Button
                        type="button"
                        size="sm"
                        variant={direction === 'downgrade' ? 'danger' : 'primary'}
                        disabled={!selected}
                        loading={pending}
                        onClick={() => void handleSwitch()}
                    >
                        {buttonLabel}
                    </Button>
                )}
            </div>
            {direction === 'downgrade' && (
                <div className={styles.warning}>{t('version_switcher.downgrade_warning')}</div>
            )}
            {target === 'cpa' && compatibility && direction !== 'same' && (
                <div className={compatibility.compatible ? styles.meta : styles.warning}>
                    <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>{t('version_switcher.schema_version')}</span>
                        <span className={styles.metaValue}>{compatibility.usage.schema_version || '-'}</span>
                    </div>
                    <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>{t('version_switcher.db_size')}</span>
                        <span className={styles.metaValue}>{formatBytes(compatibility.usage.db_size_bytes)}</span>
                    </div>
                    <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>{t('version_switcher.migrated_from')}</span>
                        <span className={styles.metaValue}>{compatibility.usage.migrated_from || '-'}</span>
                    </div>
                    {!compatibility.compatible &&
                        compatibility.warnings?.map((warning) => (
                            <div key={warning} className={styles.metaItem}>
                                <span className={styles.metaValue}>{warning}</span>
                            </div>
                        ))}
                </div>
            )}
            {target === 'cpa' && compatibilityLoading && direction !== 'same' && (
                <div className={styles.meta}>{t('common.loading')}</div>
            )}
        </div>
    )
}
