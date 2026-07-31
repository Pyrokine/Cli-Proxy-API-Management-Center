import {ConfigSection} from '@/components/config/ConfigSection'
import {Collapsible} from '@/components/ui/Collapsible'
import {
    IconCode,
    IconDiamond,
    IconKey,
    type IconProps,
    IconSatellite,
    IconSearch,
    IconShield,
    IconSlidersHorizontal,
    IconTimer,
    IconTrendingUp,
} from '@/components/ui/icons'
import {Input} from '@/components/ui/Input'
import {Select} from '@/components/ui/Select'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {TIMEZONE_OPTIONS, useTimezoneStore} from '@/stores/useTimezoneStore'
import type {
    PayloadFilterRule,
    PayloadParamValidationErrorCode,
    PayloadRule,
    PluginStoreAuthRule,
    VisualConfigEditorMode,
    VisualConfigFieldPath,
    VisualConfigRuntimeInfo,
    VisualConfigValidationErrorCode,
    VisualConfigValidationErrors,
    VisualConfigValues,
} from '@/types/visualConfig'
import {formatFileSize} from '@/utils/format'
import {type ComponentType, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {
    configFieldDomId,
    type ConfigFieldSearchEntry,
    searchConfigFields,
    type VisualSectionId,
} from './configSearchIndex'
import styles from './VisualConfigEditor.module.scss'
import {
    ApiKeysCardEditor,
    PayloadFilterRulesEditor,
    PayloadRulesEditor,
    PluginStoreAuthEditor,
    StringListEditor,
} from './VisualConfigEditorBlocks'

const EDITOR_MODE_STORAGE_KEY = 'config-management:editor-mode'

type VisualSection = {
    id: VisualSectionId
    title: string
    description: string
    icon: ComponentType<IconProps>
    errorCount: number
}

interface VisualConfigEditorProps {
    values: VisualConfigValues
    validationErrors?: VisualConfigValidationErrors
    hasPayloadValidationErrors?: boolean
    disabled?: boolean
    runtimeInfo?: VisualConfigRuntimeInfo
    onChange: (values: Partial<VisualConfigValues>) => void
}

function getValidationMessage(
    t: ReturnType<typeof useTranslation>['t'],
    errorCode?: VisualConfigValidationErrorCode | PayloadParamValidationErrorCode,
) {
    if (!errorCode) {
        return undefined
    }
    return t(`config_management.visual.validation.${errorCode}`)
}

type ToggleRowProps = {
    title: string
    description?: string
    checked: boolean
    disabled?: boolean
    tone?: 'default' | 'warning' | 'danger'
    onChange: (value: boolean) => void
}

function ToggleRow({ title, description, checked, disabled, tone = 'default', onChange }: ToggleRowProps) {
    const className =
              tone === 'danger'
              ? `${styles.toggleRow} ${styles.toggleRowDanger}`
              : tone === 'warning'
                ? `${styles.toggleRow} ${styles.toggleRowWarning}`
                : styles.toggleRow

    return (
        <div className={className}>
            <div className={styles.toggleCopy}>
                <div className={styles.toggleTitle}>{title}</div>
                {description ? <div className={styles.toggleDescription}>{description}</div> : null}
            </div>
            <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={title} />
        </div>
    )
}

function SectionGrid({ children }: { children: ReactNode }) {
    return <div className={styles.sectionGrid}>{children}</div>
}

function SectionStack({ children }: { children: ReactNode }) {
    return <div className={styles.sectionStack}>{children}</div>
}

function Divider() {
    return <div className={styles.divider} />
}

function FieldAnchor({ fieldId, children }: { fieldId: string; children: ReactNode }) {
    return (
        <div id={configFieldDomId(fieldId)} className={styles.fieldAnchor}>
            {children}
        </div>
    )
}

function TextAreaField({
                           label,
                           value,
                           placeholder,
                           hint,
                           disabled,
                           onChange,
                       }: {
    label: string
    value: string
    placeholder?: string
    hint?: string
    disabled?: boolean
    onChange: (value: string) => void
}) {
    return (
        <FieldShell label={label} hint={hint}>
            <textarea
                className={`input ${styles.yamlTextArea}`}
                value={value}
                placeholder={placeholder}
                disabled={disabled}
                spellCheck={false}
                onChange={(event) => onChange(event.target.value)}
            />
        </FieldShell>
    )
}

function SectionSubsection({
                               title,
                               description,
                               children,
                           }: {
    title: string
    description?: string
    children: ReactNode
}) {
    return (
        <div className={styles.subsection}>
            <div className={styles.subsectionHeader}>
                <h3 className={styles.subsectionTitle}>{title}</h3>
                {description ? <p className={styles.subsectionDescription}>{description}</p> : null}
            </div>
            {children}
        </div>
    )
}

function FieldShell({
                        label,
                        labelId,
                        htmlFor,
                        hint,
                        hintId,
                        error,
                        errorId,
                        meta,
                        children,
                    }: {
    label: string
    labelId?: string
    htmlFor?: string
    hint?: string
    hintId?: string
    error?: string
    errorId?: string
    meta?: ReactNode
    children: ReactNode
}) {
    return (
        <div className={styles.fieldShell}>
            <label id={labelId} htmlFor={htmlFor} className={styles.fieldLabel}>
                {label}
            </label>
            {children}
            {meta}
            {error ? (
                <div id={errorId} className='error-box'>
                    {error}
                </div>
            ) : null}
            {hint ? (
                <div id={hintId} className={styles.fieldHint}>
                    {hint}
                </div>
            ) : null}
        </div>
    )
}

function FieldMeta({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'warning' | 'danger' }) {
    const className =
              tone === 'danger'
              ? `${styles.fieldMeta} ${styles.fieldMetaDanger}`
              : tone === 'warning'
                ? `${styles.fieldMeta} ${styles.fieldMetaWarning}`
                : styles.fieldMeta

    return <div className={className}>{children}</div>
}

export function VisualConfigEditor({
                                       values,
                                       validationErrors,
                                       hasPayloadValidationErrors = false,
                                       disabled = false,
                                       runtimeInfo,
                                       onChange,
                                   }: VisualConfigEditorProps) {
    const { t }                                     = useTranslation()
    const timezone                                  = useTimezoneStore((state) => state.timezone)
    const setTimezone                               = useTimezoneStore((state) => state.setTimezone)
    const timezoneOptions                           = useMemo(
        () => TIMEZONE_OPTIONS.map((tz) => ({
            value: tz.value,
            label: tz.value === '' ? t('system_info.timezone_system', { defaultValue: '系统（浏览器默认）' }) : tz.label,
        })),
        [t],
    )
    const routingStrategyLabelId                    = useId()
    const routingStrategyHintId                     = `${routingStrategyLabelId}-hint`
    const keepaliveInputId                          = useId()
    const keepaliveHintId                           = `${keepaliveInputId}-hint`
    const keepaliveErrorId                          = `${keepaliveInputId}-error`
    const nonstreamKeepaliveInputId                 = useId()
    const nonstreamKeepaliveHintId                  = `${nonstreamKeepaliveInputId}-hint`
    const nonstreamKeepaliveErrorId                 = `${nonstreamKeepaliveInputId}-error`
    const [mode, setMode]                           = useState<VisualConfigEditorMode>(() => {
        const saved = localStorage.getItem(EDITOR_MODE_STORAGE_KEY)
        return saved === 'full' ? 'full' : 'simple'
    })
    const [activeSectionId, setActiveSectionId]     = useState<VisualSectionId>('connectivity')
    const workspaceRef                              = useRef<HTMLDivElement | null>(null)
    const sectionRefs                               = useRef<Partial<Record<VisualSectionId, HTMLElement | null>>>({})
    const sectionJumpLockUntilRef                   = useRef(0)
    const [searchQuery, setSearchQuery]             = useState('')
    const [searchOpen, setSearchOpen]               = useState(false)
    const [activeResultIndex, setActiveResultIndex] = useState(0)
    const searchListboxId                           = useId()
    const searchResultsRef                          = useRef<HTMLDivElement | null>(null)
    const searchBoxRef                              = useRef<HTMLDivElement | null>(null)
    const [jumpRequest, setJumpRequest]             = useState<{
                                                                   fieldId: string
                                                                   sectionId: VisualSectionId
                                                               } | null>(null)
    const handledJumpRef                            = useRef<{ fieldId: string; sectionId: VisualSectionId } | null>(
        null)
    const highlightTimerRef                         = useRef<number | null>(null)
    const highlightedElRef                          = useRef<HTMLElement | null>(null)

    const handleModeChange = useCallback((next: VisualConfigEditorMode) => {
        setMode(next)
        localStorage.setItem(EDITOR_MODE_STORAGE_KEY, next)
    }, [])

    const searchResults        = useMemo(() => searchConfigFields(searchQuery, t), [searchQuery, t])
    const isResultsOpen        = searchOpen && Boolean(searchQuery.trim())
    const effectiveActiveIndex = searchResults.length > 0
                                 ? Math.min(Math.max(activeResultIndex, 0), searchResults.length - 1)
                                 : -1

    const handleResultJump = useCallback(
        (entry: ConfigFieldSearchEntry) => {
            setSearchOpen(false)
            handleModeChange('full')
            setActiveSectionId(entry.sectionId)
            setJumpRequest({ fieldId: entry.fieldId, sectionId: entry.sectionId })
        },
        [handleModeChange],
    )

    const isKeepaliveDisabled          = values.streaming.keepaliveSeconds ===
                                         '' ||
                                         values.streaming.keepaliveSeconds ===
                                         '0'
    const isNonstreamKeepaliveDisabled =
              values.streaming.nonstreamKeepaliveInterval === '' || values.streaming.nonstreamKeepaliveInterval === '0'

    const portError                           = getValidationMessage(t, validationErrors?.port)
    const tlsHttpRedirectPortError            = getValidationMessage(t, validationErrors?.tlsHttpRedirectPort)
    const logsMaxSizeError                    = getValidationMessage(t, validationErrors?.logsMaxTotalSizeMb)
    const imageArtifactCacheRetentionDaysError = getValidationMessage(
        t,
        validationErrors?.imageArtifactCacheRetentionDays,
    )
    const imageArtifactCacheMaxSizeError      = getValidationMessage(
        t,
        validationErrors?.imageArtifactCacheMaxTotalSizeMb,
    )
    const errorLogsMaxFilesError              = getValidationMessage(t, validationErrors?.errorLogsMaxFiles)
    const redisUsageQueueRetentionError       = getValidationMessage(
        t,
        validationErrors?.redisUsageQueueRetentionSeconds,
    )
    const authAutoRefreshWorkersError         = getValidationMessage(t, validationErrors?.authAutoRefreshWorkers)
    const usageRetentionDaysError             = getValidationMessage(t, validationErrors?.usageRetentionDays)
    const usageRetentionMaxDbSizeMbError      = getValidationMessage(t, validationErrors?.usageRetentionMaxDbSizeMb)
    const usageRetentionWarningThresholdError = getValidationMessage(
        t,
        validationErrors?.usageRetentionWarningThresholdPct,
    )
    const autoRefreshIntervalError            = getValidationMessage(t, validationErrors?.autoRefreshInterval)
    const modelRefreshIntervalError           = getValidationMessage(t, validationErrors?.modelRefreshInterval)
    const logSizeMeta                         = (() => {
        const logSize = runtimeInfo?.logSize
        if (!logSize || logSize.status === 'loading') {
            return <FieldMeta>{t('config_management.visual.sections.runtime.log_size_loading')}</FieldMeta>
        }
        if (logSize.status === 'error') {
            return <FieldMeta tone='warning'>{t('config_management.visual.sections.runtime.log_size_error')}</FieldMeta>
        }
        return (
            <FieldMeta>
                {t('config_management.visual.sections.runtime.log_size_ready', {
                    size: formatFileSize(logSize.totalBytes),
                    count: logSize.fileCount,
                })}
            </FieldMeta>
        )
    })()
    const imageArtifactCacheSizeMeta          = (() => {
        const imageArtifactCacheSize = runtimeInfo?.imageArtifactCacheSize
        if (!imageArtifactCacheSize || imageArtifactCacheSize.status === 'loading') {
            return <FieldMeta>{t('config_management.visual.sections.runtime.image_artifact_cache_size_loading')}</FieldMeta>
        }
        if (imageArtifactCacheSize.status === 'error') {
            return (
                <FieldMeta tone='warning'>
                    {t('config_management.visual.sections.runtime.image_artifact_cache_size_error')}
                </FieldMeta>
            )
        }
        return (
            <FieldMeta>
                {t('config_management.visual.sections.runtime.image_artifact_cache_size_ready', {
                    size: formatFileSize(imageArtifactCacheSize.totalBytes),
                    count: imageArtifactCacheSize.fileCount,
                })}
            </FieldMeta>
        )
    })()
    const usageDbSizeMeta                     = (() => {
        const usageDbSize = runtimeInfo?.usageDbSize
        if (!usageDbSize || usageDbSize.status === 'loading') {
            return <FieldMeta>{t('config_management.visual.sections.runtime.db_size_loading')}</FieldMeta>
        }
        if (usageDbSize.status === 'error') {
            return <FieldMeta tone='warning'>{t('config_management.visual.sections.runtime.db_size_error')}</FieldMeta>
        }

        const text       = usageDbSize.maxSizeBytes && usageDbSize.maxSizeBytes > 0
                           ? t('config_management.visual.sections.runtime.db_size_ready_with_max', {
                size: formatFileSize(usageDbSize.sizeBytes),
                max: formatFileSize(usageDbSize.maxSizeBytes),
            })
                           : t('config_management.visual.sections.runtime.db_size_ready', {
                size: formatFileSize(usageDbSize.sizeBytes),
            })
        const statusText = usageDbSize.capped
                           ? t('config_management.visual.sections.runtime.db_size_capped')
                           : usageDbSize.warning
                             ? t('config_management.visual.sections.runtime.db_size_warning', {
                    threshold: usageDbSize.warningThresholdPct ?? 80,
                })
                             : ''

        return (
            <FieldMeta tone={usageDbSize.capped ? 'danger' : usageDbSize.warning ? 'warning' : 'default'}>
                {statusText ? `${text} · ${statusText}` : text}
            </FieldMeta>
        )
    })()
    const requestRetryError                   = getValidationMessage(t, validationErrors?.requestRetry)
    const maxRetryCredentialsError            = getValidationMessage(t, validationErrors?.maxRetryCredentials)
    const maxRetryIntervalError               = getValidationMessage(t, validationErrors?.maxRetryInterval)
    const quotaRefreshIntervalError           = getValidationMessage(t, validationErrors?.quotaRefreshInterval)
    const quotaRefreshMaxIntervalError        = getValidationMessage(t, validationErrors?.quotaRefreshMaxInterval)
    const keepaliveError                      = getValidationMessage(
        t,
        validationErrors?.['streaming.keepaliveSeconds'],
    )
    const bootstrapRetriesError               = getValidationMessage(
        t,
        validationErrors?.['streaming.bootstrapRetries'],
    )
    const nonstreamKeepaliveError             = getValidationMessage(
        t,
        validationErrors?.['streaming.nonstreamKeepaliveInterval'],
    )

    const handleApiKeysTextChange             = useCallback(
        (apiKeysText: string) => onChange({ apiKeysText }),
        [onChange],
    )
    const handleApiKeyRulesChange             = useCallback(
        (apiKeyRules: VisualConfigValues['apiKeyRules']) => onChange({ apiKeyRules }),
        [onChange],
    )
    const handlePluginStoreSourcesChange      = useCallback(
        (pluginStoreSources: string[]) => onChange({ pluginStoreSources }),
        [onChange],
    )
    const handlePluginStoreAuthChange         = useCallback(
        (pluginStoreAuth: PluginStoreAuthRule[]) => onChange({ pluginStoreAuth }),
        [onChange],
    )
    const handlePayloadDefaultRulesChange     = useCallback(
        (payloadDefaultRules: PayloadRule[]) => onChange({ payloadDefaultRules }),
        [onChange],
    )
    const handlePayloadDefaultRawRulesChange  = useCallback(
        (payloadDefaultRawRules: PayloadRule[]) => onChange({ payloadDefaultRawRules }),
        [onChange],
    )
    const handlePayloadOverrideRulesChange    = useCallback(
        (payloadOverrideRules: PayloadRule[]) => onChange({ payloadOverrideRules }),
        [onChange],
    )
    const handlePayloadOverrideRawRulesChange = useCallback(
        (payloadOverrideRawRules: PayloadRule[]) => onChange({ payloadOverrideRawRules }),
        [onChange],
    )
    const handlePayloadFilterRulesChange      = useCallback(
        (payloadFilterRules: PayloadFilterRule[]) => onChange({ payloadFilterRules }),
        [onChange],
    )

    const countErrors = useCallback(
        (fields: VisualConfigFieldPath[]) =>
            fields.reduce((total, field) => total + (validationErrors?.[field] ? 1 : 0), 0),
        [validationErrors],
    )

    const sections = useMemo<VisualSection[]>(
        () => [
            {
                id: 'connectivity',
                title: t('config_management.visual.sections.connectivity.title'),
                description: t('config_management.visual.sections.connectivity.description'),
                icon: IconKey,
                errorCount: countErrors(['port', 'tlsHttpRedirectPort']),
            },
            {
                id: 'network',
                title: t('config_management.visual.sections.network.title'),
                description: t('config_management.visual.sections.network.description'),
                icon: IconTrendingUp,
                errorCount: countErrors([
                                            'requestRetry',
                                            'maxRetryCredentials',
                                            'maxRetryInterval',
                                            'authAutoRefreshWorkers',
                                        ]),
            },
            {
                id: 'logging',
                title: t('config_management.visual.sections.logging.title'),
                description: t('config_management.visual.sections.logging.description'),
                icon: IconDiamond,
                errorCount: countErrors([
                                            'logsMaxTotalSizeMb',
                                            'imageArtifactCacheRetentionDays',
                                            'imageArtifactCacheMaxTotalSizeMb',
                                            'errorLogsMaxFiles',
                                            'redisUsageQueueRetentionSeconds',
                                            'usageRetentionDays',
                                            'usageRetentionMaxDbSizeMb',
                                            'usageRetentionWarningThresholdPct',
                                            'autoRefreshInterval',
                                            'modelRefreshInterval',
                                        ]),
            },
            {
                id: 'quota',
                title: t('config_management.visual.sections.quota.title'),
                description: t('config_management.visual.sections.quota.description'),
                icon: IconTimer,
                errorCount: countErrors(['quotaRefreshInterval', 'quotaRefreshMaxInterval']),
            },
            {
                id: 'streaming',
                title: t('config_management.visual.sections.streaming.title'),
                description: t('config_management.visual.sections.streaming.description'),
                icon: IconSatellite,
                errorCount: countErrors([
                                            'streaming.keepaliveSeconds',
                                            'streaming.bootstrapRetries',
                                            'streaming.nonstreamKeepaliveInterval',
                                        ]),
            },
            {
                id: 'advanced',
                title: t('config_management.visual.sections.advanced.title'),
                description: t('config_management.visual.sections.advanced.description'),
                icon: IconShield,
                errorCount: 0,
            },
            {
                id: 'payload',
                title: t('config_management.visual.sections.payload.title'),
                description: t('config_management.visual.sections.payload.description'),
                icon: IconCode,
                errorCount: hasPayloadValidationErrors ? 1 : 0,
            },
        ],
        [countErrors, hasPayloadValidationErrors, t],
    )

    const hasValidationIssues       = sections.some((section) => section.errorCount > 0) || hasPayloadValidationErrors
    const hasHiddenValidationIssues = (Object.keys(validationErrors ?? {}) as VisualConfigFieldPath[]).some(
        (field) => field !== 'port' && Boolean(validationErrors?.[field]),
    ) || hasPayloadValidationErrors
    const activeSection             = sections.find((section) => section.id === activeSectionId) ?? sections[0]

    const getSectionAnchor = useCallback(() => {
        const headerHeight = Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--header-height'),
        )
        return (Number.isFinite(headerHeight) ? headerHeight : 64) + 128
    }, [])

    const updateActiveSection = useCallback(() => {
        if (Date.now() < sectionJumpLockUntilRef.current) {
            return
        }

        const anchor      = getSectionAnchor()
        let nextSectionId = sections[0]?.id ?? 'server'

        for (const section of sections) {
            const element = sectionRefs.current[section.id]
            if (!element) {
                continue
            }
            if (element.getBoundingClientRect().top <= anchor) {
                nextSectionId = section.id
            } else {
                break
            }
        }

        setActiveSectionId((current) => (current === nextSectionId ? current : nextSectionId))
    }, [getSectionAnchor, sections])

    useEffect(() => {
        if (mode !== 'full') {
            return undefined
        }

        let frameId          = 0
        const scheduleUpdate = () => {
            if (frameId !== 0) {
                return
            }
            frameId = window.requestAnimationFrame(() => {
                frameId = 0
                updateActiveSection()
            })
        }

        const scrollTarget = (() => {
            let element = workspaceRef.current?.parentElement ?? null
            while (element) {
                const overflowY = getComputedStyle(element).overflowY
                if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight) {
                    return element
                }
                element = element.parentElement
            }
            return window
        })()

        scheduleUpdate()
        scrollTarget.addEventListener('scroll', scheduleUpdate, { passive: true })
        window.addEventListener('resize', scheduleUpdate)

        return () => {
            if (frameId !== 0) {
                window.cancelAnimationFrame(frameId)
            }
            scrollTarget.removeEventListener('scroll', scheduleUpdate)
            window.removeEventListener('resize', scheduleUpdate)
        }
    }, [mode, updateActiveSection])

    const handleSectionJump = useCallback((sectionId: VisualSectionId) => {
        const element = sectionRefs.current[sectionId]
        if (!element) {
            return
        }

        const lockUntil                 = Date.now() + 900
        sectionJumpLockUntilRef.current = lockUntil
        setActiveSectionId(sectionId)
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        window.setTimeout(() => {
            if (sectionJumpLockUntilRef.current === lockUntil) {
                sectionJumpLockUntilRef.current = 0
                updateActiveSection()
            }
        }, 950)
    }, [updateActiveSection])

    useEffect(() => {
        if (mode !== 'full' || !jumpRequest || handledJumpRef.current === jumpRequest) {
            return
        }

        handledJumpRef.current          = jumpRequest
        const { fieldId, sectionId }    = jumpRequest
        const element                   = document.getElementById(configFieldDomId(fieldId))
        const lockUntil                 = Date.now() + 900
        sectionJumpLockUntilRef.current = lockUntil
        setActiveSectionId(sectionId)

        if (!element) {
            sectionRefs.current[sectionId]?.scrollIntoView({ block: 'start' })
            window.setTimeout(() => {
                if (sectionJumpLockUntilRef.current === lockUntil) {
                    sectionJumpLockUntilRef.current = 0
                    updateActiveSection()
                }
            }, 950)
            return
        }

        const details = element.closest('details') ?? element.querySelector('details')
        if (details && !details.open) {
            details.open = true
        }

        if (highlightTimerRef.current !== null) {
            window.clearTimeout(highlightTimerRef.current)
            highlightedElRef.current?.classList.remove(styles.fieldHighlightActive)
        }

        sectionRefs.current[sectionId]?.scrollIntoView({ block: 'start' })
        window.requestAnimationFrame(() => {
            element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
            element.classList.add(styles.fieldHighlightActive)
        })
        highlightedElRef.current  = element
        highlightTimerRef.current = window.setTimeout(() => {
            element.classList.remove(styles.fieldHighlightActive)
            highlightTimerRef.current = null
            highlightedElRef.current  = null
            if (sectionJumpLockUntilRef.current === lockUntil) {
                sectionJumpLockUntilRef.current = 0
                updateActiveSection()
            }
        }, 1800)
    }, [jumpRequest, mode, updateActiveSection])

    useEffect(
        () => () => {
            if (highlightTimerRef.current !== null) {
                window.clearTimeout(highlightTimerRef.current)
            }
        },
        [],
    )

    useEffect(() => {
        if (!searchOpen) {
            return undefined
        }

        const handlePointerDown = (event: MouseEvent) => {
            if (searchBoxRef.current && !searchBoxRef.current.contains(event.target as Node)) {
                setSearchOpen(false)
            }
        }

        document.addEventListener('mousedown', handlePointerDown)
        return () => document.removeEventListener('mousedown', handlePointerDown)
    }, [searchOpen])

    useEffect(() => {
        if (!isResultsOpen || effectiveActiveIndex < 0) {
            return
        }

        const node = searchResultsRef.current?.querySelector<HTMLElement>(
            `[data-result-index="${effectiveActiveIndex}"]`,
        )
        node?.scrollIntoView({ block: 'nearest' })
    }, [effectiveActiveIndex, isResultsOpen])

    const hostField = (
        <FieldAnchor fieldId='host'>
            <Input
                label={t('config_management.visual.sections.server.host')}
                placeholder='127.0.0.1'
                value={values.host}
                onChange={(e) => onChange({ host: e.target.value })}
                disabled={disabled}
                hint={t('config_management.visual.sections.server.host_hint')}
            />
        </FieldAnchor>
    )

    const portField = (
        <FieldAnchor fieldId='port'>
            <Input
                label={t('config_management.visual.sections.server.port')}
                type='number'
                placeholder='8317'
                value={values.port}
                onChange={(e) => onChange({ port: e.target.value })}
                disabled={disabled}
                error={portError}
            />
        </FieldAnchor>
    )

    const proxyUrlField = (
        <FieldAnchor fieldId='proxyUrl'>
            <Input
                label={t('config_management.visual.sections.network.proxy_url')}
                placeholder='socks5://user:pass@127.0.0.1:1080/'
                value={values.proxyUrl}
                onChange={(e) => onChange({ proxyUrl: e.target.value })}
                disabled={disabled}
            />
        </FieldAnchor>
    )

    const apiKeysField = (
        <FieldAnchor fieldId='apiKeys'>
            <div className={styles.subsection}>
                <ApiKeysCardEditor
                    value={values.apiKeysText}
                    modelRules={values.apiKeyRules}
                    disabled={disabled}
                    onChange={handleApiKeysTextChange}
                    onModelRulesChange={handleApiKeyRulesChange}
                />
            </div>
        </FieldAnchor>
    )

    const debugToggle = (
        <FieldAnchor fieldId='debug'>
            <ToggleRow
                title={t('config_management.visual.sections.system.debug')}
                description={t('config_management.visual.sections.system.debug_desc')}
                checked={values.debug}
                disabled={disabled}
                onChange={(debug) => onChange({ debug })}
            />
        </FieldAnchor>
    )

    const loggingToFileToggle = (
        <FieldAnchor fieldId='loggingToFile'>
            <ToggleRow
                title={t('config_management.visual.sections.system.logging_to_file')}
                description={t('config_management.visual.sections.system.logging_to_file_desc')}
                checked={values.loggingToFile}
                disabled={disabled}
                onChange={(loggingToFile) => onChange({ loggingToFile })}
            />
        </FieldAnchor>
    )

    const quotaSwitchProjectToggle = (
        <FieldAnchor fieldId='quotaSwitchProject'>
            <ToggleRow
                title={t('config_management.visual.sections.quota.switch_project')}
                description={t('config_management.visual.sections.quota.switch_project_desc')}
                checked={values.quotaSwitchProject}
                disabled={disabled}
                onChange={(quotaSwitchProject) => onChange({ quotaSwitchProject })}
            />
        </FieldAnchor>
    )

    const quotaSwitchPreviewModelToggle = (
        <FieldAnchor fieldId='quotaSwitchPreviewModel'>
            <ToggleRow
                title={t('config_management.visual.sections.quota.switch_preview_model')}
                description={t('config_management.visual.sections.quota.switch_preview_model_desc')}
                checked={values.quotaSwitchPreviewModel}
                disabled={disabled}
                onChange={(quotaSwitchPreviewModel) => onChange({ quotaSwitchPreviewModel })}
            />
        </FieldAnchor>
    )

    const navContent = (
        <div className={styles.navList}>
            {sections.map((section, index) => {
                const Icon = section.icon

                return (
                    <button
                        key={section.id}
                        type='button'
                        className={`${styles.navButton} ${
                            activeSectionId === section.id ? styles.navButtonActive : ''
                        }`}
                        onClick={() => handleSectionJump(section.id)}
                    >
                        <span className={styles.navIndex}>{String(index + 1).padStart(2, '0')}</span>
                        <span className={styles.navMain}>
                            <span className={styles.navHeadingRow}>
                                <span className={styles.navLabelWrap}>
                                    <span className={styles.navIcon}>
                                        <Icon size={14} />
                                    </span>
                                    <span className={styles.navLabel}>{section.title}</span>
                                </span>
                                {section.errorCount > 0 ? (
                                    <span className={styles.navBadge} aria-hidden='true'>
                                        {section.errorCount}
                                    </span>
                                ) : null}
                            </span>
                            <span className={styles.navDescription}>{section.description}</span>
                        </span>
                    </button>
                )
            })}
        </div>
    )

    return (
        <div className={styles.visualEditor}>
            <div className={styles.overview}>
                <div className={styles.overviewHeader}>
                    <div
                        className={styles.modeSwitch}
                        role='group'
                        aria-label={t('config_management.visual.mode.label')}
                    >
                        <button
                            type='button'
                            className={`${styles.modeButton} ${mode === 'simple' ? styles.modeButtonActive : ''}`}
                            onClick={() => handleModeChange('simple')}
                            aria-pressed={mode === 'simple'}
                        >
                            <IconSlidersHorizontal size={14} />
                            {t('config_management.visual.mode.simple')}
                        </button>
                        <button
                            type='button'
                            className={`${styles.modeButton} ${mode === 'full' ? styles.modeButtonActive : ''}`}
                            onClick={() => handleModeChange('full')}
                            aria-pressed={mode === 'full'}
                        >
                            {t('config_management.visual.mode.full')}
                        </button>
                    </div>
                    <div className={styles.overviewMeta}>
                        {mode === 'full' && activeSection ? (
                            <span className={styles.overviewPill}>{activeSection.title}</span>
                        ) : null}
                        {hasValidationIssues ? (
                            <span className={`${styles.overviewPill} ${styles.overviewPillWarning}`}>
                                {t('config_management.visual.validation.validation_blocked')}
                            </span>
                        ) : null}
                    </div>
                </div>

                <div className={styles.searchBox} ref={searchBoxRef}>
                    <Input
                        className={styles.searchControl}
                        placeholder={t('config_management.visual.search.placeholder')}
                        aria-label={t('config_management.visual.search.placeholder')}
                        role='combobox'
                        aria-autocomplete='list'
                        aria-expanded={isResultsOpen}
                        aria-controls={isResultsOpen ? searchListboxId : undefined}
                        aria-activedescendant={
                            isResultsOpen && effectiveActiveIndex >= 0
                            ? `${searchListboxId}-opt-${effectiveActiveIndex}`
                            : undefined
                        }
                        value={searchQuery}
                        onChange={(event) => {
                            setSearchQuery(event.target.value)
                            setSearchOpen(true)
                            setActiveResultIndex(0)
                        }}
                        onFocus={() => setSearchOpen(true)}
                        onKeyDown={(event) => {
                            if (event.nativeEvent.isComposing) {
                                return
                            }
                            if (event.key === 'Escape') {
                                setSearchOpen(false)
                                return
                            }
                            if (event.key === 'ArrowDown') {
                                event.preventDefault()
                                if (!isResultsOpen) {
                                    setSearchOpen(true)
                                    return
                                }
                                if (searchResults.length === 0) {
                                    return
                                }
                                setActiveResultIndex((effectiveActiveIndex + 1) % searchResults.length)
                                return
                            }
                            if (event.key === 'ArrowUp') {
                                event.preventDefault()
                                if (!isResultsOpen) {
                                    setSearchOpen(true)
                                    return
                                }
                                if (searchResults.length === 0) {
                                    return
                                }
                                setActiveResultIndex(
                                    effectiveActiveIndex <= 0 ? searchResults.length - 1 : effectiveActiveIndex - 1,
                                )
                                return
                            }
                            if (event.key === 'Enter' && isResultsOpen && searchResults.length > 0) {
                                event.preventDefault()
                                handleResultJump(searchResults[effectiveActiveIndex] ?? searchResults[0])
                            }
                        }}
                        rightElement={
                            <span className={styles.searchIcon} aria-hidden='true'>
                                <IconSearch size={16} />
                            </span>
                        }
                    />
                    {isResultsOpen ? (
                        <div
                            className={styles.searchResults}
                            role='listbox'
                            id={searchListboxId}
                            aria-label={t('config_management.visual.search.placeholder')}
                            ref={searchResultsRef}
                        >
                            {searchResults.length > 0 ? (
                                searchResults.map((entry, index) => (
                                    <button
                                        key={entry.fieldId}
                                        type='button'
                                        role='option'
                                        id={`${searchListboxId}-opt-${index}`}
                                        data-result-index={index}
                                        tabIndex={-1}
                                        aria-selected={index === effectiveActiveIndex}
                                        className={`${styles.searchResultItem} ${
                                            index === effectiveActiveIndex ? styles.searchResultItemActive : ''
                                        }`}
                                        onMouseEnter={() => setActiveResultIndex(index)}
                                        onClick={() => handleResultJump(entry)}
                                    >
                                        <span className={styles.searchResultLabel}>
                                            {t(entry.labelKey)}
                                            {entry.qualifierKey ? (
                                                <span className={styles.searchResultQualifier}>
                                                    {t(entry.qualifierKey)}
                                                </span>
                                            ) : null}
                                        </span>
                                        <span className={styles.searchResultSection}>
                                            {t(`config_management.visual.sections.${entry.sectionId}.title`)}
                                        </span>
                                    </button>
                                ))
                            ) : (
                                 <div className={styles.searchEmpty}>
                                     {t('config_management.visual.search.no_results')}
                                 </div>
                             )}
                        </div>
                    ) : null}
                </div>
            </div>

            {mode === 'simple' ? (
                <div className={styles.simpleView}>
                    {hasHiddenValidationIssues ? (
                        <div className={styles.simpleBanner} role='alert'>
                            <span>{t('config_management.visual.mode.validation_banner')}</span>
                            <button
                                type='button'
                                className={styles.simpleBannerAction}
                                onClick={() => handleModeChange('full')}
                            >
                                {t('config_management.visual.mode.switch_to_full')}
                            </button>
                        </div>
                    ) : null}

                    <div className={styles.simpleForm}>
                        <div className={styles.simpleField}>{hostField}</div>
                        <div className={styles.simpleField}>{portField}</div>
                        {apiKeysField}
                        <div className={styles.simpleField}>{proxyUrlField}</div>
                        {debugToggle}
                        {loggingToFileToggle}
                        {quotaSwitchProjectToggle}
                        {quotaSwitchPreviewModelToggle}
                    </div>

                    <button
                        type='button'
                        className={styles.simpleMore}
                        onClick={() => handleModeChange('full')}
                    >
                        {t('config_management.visual.mode.more_settings', { total: sections.length })}
                    </button>
                </div>
            ) : (
                 <div ref={workspaceRef} className={styles.workspace}>
                     <aside className={styles.sidebar}>
                         <div className={styles.sidebarRail}>{navContent}</div>
                     </aside>

                     <div className={styles.sections}>
                         <ConfigSection
                             id='connectivity'
                             ref={(node) => {
                                 sectionRefs.current.connectivity = node
                             }}
                             indexLabel='01'
                             icon={<IconKey size={16} />}
                             title={t('config_management.visual.sections.connectivity.title')}
                             description={t('config_management.visual.sections.connectivity.description')}
                         >
                             <SectionStack>
                                 <SectionGrid>
                                     {hostField}
                                     {portField}
                                 </SectionGrid>

                                 <SectionSubsection
                                     title={t('config_management.visual.sections.tls.title')}
                                     description={t('config_management.visual.sections.tls.description')}
                                 >
                                     <SectionStack>
                                         <FieldAnchor fieldId='tlsEnable'>
                                             <ToggleRow
                                                 title={t('config_management.visual.sections.tls.enable')}
                                                 description={t('config_management.visual.sections.tls.enable_desc')}
                                                 checked={values.tlsEnable}
                                                 disabled={disabled}
                                                 onChange={(tlsEnable) => onChange({ tlsEnable })}
                                             />
                                         </FieldAnchor>

                                         <Divider />
                                         <SectionGrid>
                                             <FieldAnchor fieldId='tlsCert'>
                                                 <Input
                                                     label={t('config_management.visual.sections.tls.cert')}
                                                     placeholder='/path/to/cert.pem'
                                                     value={values.tlsCert}
                                                     onChange={(e) => onChange({ tlsCert: e.target.value })}
                                                     disabled={disabled}
                                                 />
                                             </FieldAnchor>
                                             <FieldAnchor fieldId='tlsKey'>
                                                 <Input
                                                     label={t('config_management.visual.sections.tls.key')}
                                                     placeholder='/path/to/key.pem'
                                                     value={values.tlsKey}
                                                     onChange={(e) => onChange({ tlsKey: e.target.value })}
                                                     disabled={disabled}
                                                 />
                                             </FieldAnchor>
                                             <FieldAnchor fieldId='tlsHttpRedirectPort'>
                                                 <Input
                                                     label={t(
                                                         'config_management.visual.sections.tls.http_redirect_port',
                                                         { defaultValue: 'HTTP 跳转端口' },
                                                     )}
                                                     type='number'
                                                     placeholder='80'
                                                     value={values.tlsHttpRedirectPort}
                                                     onChange={(e) => onChange({ tlsHttpRedirectPort: e.target.value })}
                                                     disabled={disabled}
                                                     error={tlsHttpRedirectPortError}
                                                 />
                                             </FieldAnchor>
                                         </SectionGrid>
                                         <FieldAnchor fieldId='tlsRequireForAuth'>
                                             <ToggleRow
                                                 title={t(
                                                     'config_management.visual.sections.tls.require_for_auth',
                                                     { defaultValue: '认证接口强制 HTTPS' },
                                                 )}
                                                 description={t(
                                                     'config_management.visual.sections.tls.require_for_auth_desc',
                                                     { defaultValue: '非本机访问认证接口时要求 HTTPS' },
                                                 )}
                                                 checked={values.tlsRequireForAuth}
                                                 disabled={disabled}
                                                 tone='warning'
                                                 onChange={(tlsRequireForAuth) => onChange({ tlsRequireForAuth })}
                                             />
                                         </FieldAnchor>
                                         <FieldAnchor fieldId='tlsTrustForwardedProto'>
                                             <ToggleRow
                                                 title={t('config_management.visual.sections.tls.trust_forwarded_proto')}
                                                 description={t(
                                                     'config_management.visual.sections.tls.trust_forwarded_proto_desc',
                                                 )}
                                                 checked={values.tlsTrustForwardedProto}
                                                 disabled={disabled}
                                                 tone='danger'
                                                 onChange={(tlsTrustForwardedProto) => onChange({ tlsTrustForwardedProto })}
                                             />
                                         </FieldAnchor>
                                     </SectionStack>
                                 </SectionSubsection>

                                 <SectionSubsection
                                     title={t('config_management.visual.sections.remote.title')}
                                     description={t('config_management.visual.sections.remote.description')}
                                 >
                                     <SectionStack>
                                         <SectionGrid>
                                             <FieldAnchor fieldId='rmAllowRemote'>
                                                 <ToggleRow
                                                     title={t('config_management.visual.sections.remote.allow_remote')}
                                                     description={t(
                                                         'config_management.visual.sections.remote.allow_remote_desc')}
                                                     checked={values.rmAllowRemote}
                                                     disabled={disabled}
                                                     tone='warning'
                                                     onChange={(rmAllowRemote) => onChange({ rmAllowRemote })}
                                                 />
                                             </FieldAnchor>
                                             <ToggleRow
                                                 title={t('config_management.visual.sections.remote.disable_panel')}
                                                 description={t(
                                                     'config_management.visual.sections.remote.disable_panel_desc')}
                                                 checked={values.rmDisableControlPanel}
                                                 disabled={disabled}
                                                 onChange={(rmDisableControlPanel) => onChange({ rmDisableControlPanel })}
                                             />
                                             <ToggleRow
                                                 title={t(
                                                     'config_management.visual.sections.remote.auto_update_panel',
                                                     {
                                                         defaultValue: 'Auto-install panel updates',
                                                     },
                                                 )}
                                                 description={t(
                                                     'config_management.visual.sections.remote.auto_update_panel_desc',
                                                     {
                                                         defaultValue: 'Automatically download and install detected panel updates',
                                                     },
                                                 )}
                                                 checked={values.rmAutoUpdatePanel}
                                                 disabled={disabled}
                                                 onChange={(rmAutoUpdatePanel) => onChange({ rmAutoUpdatePanel })}
                                             />
                                             <ToggleRow
                                                 title={t('config_management.visual.sections.remote.auto_update_cpa', {
                                                     defaultValue: 'Auto-update backend',
                                                 })}
                                                 description={t(
                                                     'config_management.visual.sections.remote.auto_update_cpa_desc',
                                                     {
                                                         defaultValue: 'Automatically download and install detected CPA backend updates',
                                                     },
                                                 )}
                                                 checked={values.rmAutoUpdateCPA}
                                                 disabled={disabled}
                                                 onChange={(rmAutoUpdateCPA) => onChange({ rmAutoUpdateCPA })}
                                             />
                                         </SectionGrid>
                                         <FieldShell
                                             label={t('config_management.visual.sections.remote.check_interval', {
                                                 defaultValue: 'Check interval',
                                             })}
                                             hint={t('config_management.visual.sections.remote.check_interval_hint', {
                                                 defaultValue:
                                                     'How often the backend polls for new versions. "Off" disables background checks (manual refresh still works).',
                                             })}
                                         >
                                             <Select
                                                 value={values.rmAutoCheckUpdate ?
                                                        values.rmCheckInterval || '180' :
                                                        '0'}
                                                 options={[
                                                     {
                                                         value: '0',
                                                         label: t(
                                                             'config_management.visual.sections.remote.check_interval_off',
                                                             {
                                                                 defaultValue: 'Off',
                                                             },
                                                         ),
                                                     },
                                                     { value: '60', label: '1h' },
                                                     { value: '180', label: '3h' },
                                                     { value: '360', label: '6h' },
                                                     { value: '720', label: '12h' },
                                                     { value: '1440', label: '24h' },
                                                 ]}
                                                 disabled={disabled}
                                                 onChange={(nextValue) => {
                                                     // "0" collapses to auto-check-update=false; any positive
                                                     // value enables and stores the interval in minutes.
                                                     if (nextValue === '0') {
                                                         onChange({ rmAutoCheckUpdate: false, rmCheckInterval: '' })
                                                     } else {
                                                         onChange({
                                                                      rmAutoCheckUpdate: true,
                                                                      rmCheckInterval: nextValue,
                                                                  })
                                                     }
                                                 }}
                                             />
                                         </FieldShell>
                                         <SectionGrid>
                                             <FieldAnchor fieldId='rmSecretKey'>
                                                 <Input
                                                     label={t('config_management.visual.sections.remote.secret_key')}
                                                     type='password'
                                                     placeholder={t(
                                                         'config_management.visual.sections.remote.secret_key_placeholder')}
                                                     value={values.rmSecretKey}
                                                     onChange={(e) => onChange({ rmSecretKey: e.target.value })}
                                                     disabled={disabled}
                                                     hint={t('config_management.visual.sections.remote.secret_key_hint')}
                                                 />
                                             </FieldAnchor>
                                             <Input
                                                 label={t('config_management.visual.sections.remote.panel_repo')}
                                                 placeholder='https://github.com/Pyrokine/Cli-Proxy-API-Management-Center'
                                                 value={values.rmPanelRepo}
                                                 onChange={(e) => onChange({ rmPanelRepo: e.target.value })}
                                                 disabled={disabled}
                                             />
                                             <Input
                                                 label={t('config_management.visual.sections.remote.cpa_repo', {
                                                     defaultValue: 'CPA GitHub Repository',
                                                 })}
                                                 placeholder='https://github.com/Pyrokine/CLIProxyAPI'
                                                 value={values.rmCpaRepo}
                                                 onChange={(e) => onChange({ rmCpaRepo: e.target.value })}
                                                 disabled={disabled}
                                             />
                                         </SectionGrid>
                                     </SectionStack>
                                 </SectionSubsection>

                                 <SectionSubsection
                                     title={t('config_management.visual.sections.auth.title')}
                                     description={t('config_management.visual.sections.auth.description')}
                                 >
                                     <SectionStack>
                                         <FieldAnchor fieldId='authDir'>
                                             <Input
                                                 label={t('config_management.visual.sections.auth.auth_dir')}
                                                 placeholder='~/.cli-proxy-api'
                                                 value={values.authDir}
                                                 onChange={(e) => onChange({ authDir: e.target.value })}
                                                 disabled={disabled}
                                                 hint={t('config_management.visual.sections.auth.auth_dir_hint')}
                                             />
                                         </FieldAnchor>
                                         {apiKeysField}
                                     </SectionStack>
                                 </SectionSubsection>
                             </SectionStack>
                         </ConfigSection>

                         <ConfigSection
                             id='network'
                             ref={(node) => {
                                 sectionRefs.current.network = node
                             }}
                             indexLabel='02'
                             icon={<IconTrendingUp size={16} />}
                             title={t('config_management.visual.sections.network.title')}
                             description={t('config_management.visual.sections.network.description')}
                         >
                             <SectionStack>
                                 <SectionGrid>
                                     {proxyUrlField}
                                     <FieldAnchor fieldId='requestRetry'>
                                         <Input
                                             label={t('config_management.visual.sections.network.request_retry')}
                                             type='number'
                                             placeholder='3'
                                             value={values.requestRetry}
                                             onChange={(e) => onChange({ requestRetry: e.target.value })}
                                             disabled={disabled}
                                             error={requestRetryError}
                                         />
                                     </FieldAnchor>
                                     <FieldAnchor fieldId='maxRetryCredentials'>
                                         <Input
                                             label={t('config_management.visual.sections.network.max_retry_credentials')}
                                             type='number'
                                             placeholder='0'
                                             value={values.maxRetryCredentials}
                                             onChange={(e) => onChange({ maxRetryCredentials: e.target.value })}
                                             disabled={disabled}
                                             hint={t(
                                                 'config_management.visual.sections.network.max_retry_credentials_hint')}
                                             error={maxRetryCredentialsError}
                                         />
                                     </FieldAnchor>
                                     <FieldAnchor fieldId='maxRetryInterval'>
                                         <Input
                                             label={t('config_management.visual.sections.network.max_retry_interval')}
                                             type='number'
                                             placeholder='30'
                                             value={values.maxRetryInterval}
                                             onChange={(e) => onChange({ maxRetryInterval: e.target.value })}
                                             disabled={disabled}
                                             error={maxRetryIntervalError}
                                         />
                                     </FieldAnchor>
                                     <FieldAnchor fieldId='authAutoRefreshWorkers'>
                                         <Input
                                             label={t(
                                                 'config_management.visual.sections.network.auth_auto_refresh_workers')}
                                             type='number'
                                             placeholder='16'
                                             value={values.authAutoRefreshWorkers}
                                             onChange={(e) => onChange({ authAutoRefreshWorkers: e.target.value })}
                                             disabled={disabled}
                                             hint={t(
                                                 'config_management.visual.sections.network.auth_auto_refresh_workers_hint')}
                                             error={authAutoRefreshWorkersError}
                                         />
                                     </FieldAnchor>
                                     <FieldAnchor fieldId='gptImage2BaseModel'>
                                         <Input
                                             label={t(
                                                 'config_management.visual.sections.network.gpt_image_2_base_model',
                                                 { defaultValue: 'gpt-image-2 基础模型' },
                                             )}
                                             placeholder='gpt-5.4-mini'
                                             value={values.gptImage2BaseModel}
                                             onChange={(e) => onChange({ gptImage2BaseModel: e.target.value })}
                                             disabled={disabled}
                                             hint={t(
                                                 'config_management.visual.sections.network.gpt_image_2_base_model_hint',
                                                 { defaultValue: '代理 gpt-image-2 hosted image_generation tool 时使用' },
                                             )}
                                         />
                                     </FieldAnchor>
                                     <FieldAnchor fieldId='corsAllowedOrigins'>
                                         <Input
                                             label={t('config_management.visual.sections.network.cors_allowed_origins')}
                                             placeholder='https://example.com, https://admin.example.com'
                                             value={values.corsAllowedOrigins}
                                             onChange={(e) => onChange({ corsAllowedOrigins: e.target.value })}
                                             disabled={disabled}
                                             hint={t(
                                                 'config_management.visual.sections.network.cors_allowed_origins_hint')}
                                         />
                                     </FieldAnchor>
                                     <Input
                                         label={t('config_management.visual.sections.network.session_affinity_ttl')}
                                         placeholder='1h'
                                         value={values.routingSessionAffinityTTL}
                                         onChange={(e) => onChange({ routingSessionAffinityTTL: e.target.value })}
                                         disabled={disabled}
                                         hint={t('config_management.visual.sections.network.session_affinity_ttl_hint')}
                                     />
                                     <FieldAnchor fieldId='routingStrategy'>
                                         <FieldShell
                                             label={t('config_management.visual.sections.network.routing_strategy')}
                                             labelId={routingStrategyLabelId}
                                             hint={t('config_management.visual.sections.network.routing_strategy_hint')}
                                             hintId={routingStrategyHintId}
                                         >
                                             <Select
                                                 value={values.routingStrategy}
                                                 options={[
                                                     {
                                                         value: 'round-robin',
                                                         label: t(
                                                             'config_management.visual.sections.network.strategy_round_robin',
                                                         ),
                                                     },
                                                     {
                                                         value: 'fill-first',
                                                         label: t(
                                                             'config_management.visual.sections.network.strategy_fill_first',
                                                         ),
                                                     },
                                                 ]}
                                                 id={`${routingStrategyLabelId}-select`}
                                                 disabled={disabled}
                                                 ariaLabelledBy={routingStrategyLabelId}
                                                 ariaDescribedBy={routingStrategyHintId}
                                                 onChange={(nextValue) =>
                                                     onChange({
                                                                  routingStrategy: nextValue as VisualConfigValues['routingStrategy'],
                                                              })
                                                 }
                                             />
                                         </FieldShell>
                                     </FieldAnchor>
                                 </SectionGrid>

                                 <SectionGrid>
                                     <FieldAnchor fieldId='forceModelPrefix'>
                                         <ToggleRow
                                             title={t('config_management.visual.sections.network.force_model_prefix')}
                                             description={t(
                                                 'config_management.visual.sections.network.force_model_prefix_desc')}
                                             checked={values.forceModelPrefix}
                                             disabled={disabled}
                                             onChange={(forceModelPrefix) => onChange({ forceModelPrefix })}
                                         />
                                     </FieldAnchor>
                                     <ToggleRow
                                         title={t('config_management.visual.sections.network.enable_gemini_cli_endpoint')}
                                         description={t(
                                             'config_management.visual.sections.network.enable_gemini_cli_endpoint_desc')}
                                         checked={values.enableGeminiCliEndpoint}
                                         disabled={disabled}
                                         tone='warning'
                                         onChange={(enableGeminiCliEndpoint) => onChange({ enableGeminiCliEndpoint })}
                                     />
                                     <ToggleRow
                                         title={t('config_management.visual.sections.network.passthrough_headers')}
                                         description={t(
                                             'config_management.visual.sections.network.passthrough_headers_desc')}
                                         checked={values.passthroughHeaders}
                                         disabled={disabled}
                                         onChange={(passthroughHeaders) => onChange({ passthroughHeaders })}
                                     />
                                     <FieldAnchor fieldId='disableImageGeneration'>
                                         <FieldShell
                                             label={t(
                                                 'config_management.visual.sections.network.disable_image_generation')}
                                             hint={t(
                                                 'config_management.visual.sections.network.disable_image_generation_hint')}
                                         >
                                             <Select
                                                 value={values.disableImageGeneration}
                                                 options={[
                                                     {
                                                         value: 'off',
                                                         label: t(
                                                             'config_management.visual.sections.network.disable_image_generation_off',
                                                             { defaultValue: 'off（启用）' },
                                                         ),
                                                     },
                                                     {
                                                         value: 'all',
                                                         label: t(
                                                             'config_management.visual.sections.network.disable_image_generation_all',
                                                             { defaultValue: 'all（全部停用）' },
                                                         ),
                                                     },
                                                     {
                                                         value: 'chat',
                                                         label: t(
                                                             'config_management.visual.sections.network.disable_image_generation_chat'),
                                                     },
                                                     {
                                                         value: 'passthrough',
                                                         label: t(
                                                             'config_management.visual.sections.network.disable_image_generation_passthrough',
                                                             { defaultValue: 'passthrough（透传）' },
                                                         ),
                                                     },
                                                 ]}
                                                 disabled={disabled}
                                                 onChange={(disableImageGeneration) => onChange({ disableImageGeneration: disableImageGeneration as VisualConfigValues['disableImageGeneration'] })}
                                             />
                                         </FieldShell>
                                     </FieldAnchor>
                                     <FieldAnchor fieldId='routingSessionAffinity'>
                                         <ToggleRow
                                             title={t('config_management.visual.sections.network.session_affinity')}
                                             description={t(
                                                 'config_management.visual.sections.network.session_affinity_desc')}
                                             checked={values.routingSessionAffinity}
                                             disabled={disabled}
                                             onChange={(routingSessionAffinity) => onChange({ routingSessionAffinity })}
                                         />
                                     </FieldAnchor>
                                     <FieldAnchor fieldId='wsAuth'>
                                         <ToggleRow
                                             title={t('config_management.visual.sections.network.ws_auth')}
                                             description={t('config_management.visual.sections.network.ws_auth_desc')}
                                             checked={values.wsAuth}
                                             disabled={disabled}
                                             onChange={(wsAuth) => onChange({ wsAuth })}
                                         />
                                     </FieldAnchor>
                                     <FieldAnchor fieldId='allowQueryAuth'>
                                         <ToggleRow
                                             title={t('config_management.visual.sections.network.allow_query_auth')}
                                             description={t(
                                                 'config_management.visual.sections.network.allow_query_auth_desc')}
                                             checked={values.allowQueryAuth}
                                             disabled={disabled}
                                             tone='danger'
                                             onChange={(allowQueryAuth) => onChange({ allowQueryAuth })}
                                         />
                                     </FieldAnchor>
                                 </SectionGrid>
                             </SectionStack>
                         </ConfigSection>

                         <ConfigSection
                             id='logging'
                             ref={(node) => {
                                 sectionRefs.current.logging = node
                             }}
                             indexLabel='03'
                             icon={<IconDiamond size={16} />}
                             title={t('config_management.visual.sections.logging.title')}
                             description={t('config_management.visual.sections.logging.description')}
                         >
                             <SectionStack>
                                 <SectionGrid>
                                     {debugToggle}
                                     <FieldAnchor fieldId='commercialMode'>
                                         <ToggleRow
                                             title={t('config_management.visual.sections.system.commercial_mode')}
                                             description={t(
                                                 'config_management.visual.sections.system.commercial_mode_desc')}
                                             checked={values.commercialMode}
                                             disabled={disabled}
                                             onChange={(commercialMode) => onChange({ commercialMode })}
                                         />
                                     </FieldAnchor>
                                     {loggingToFileToggle}
                                     <FieldAnchor fieldId='requestLog'>
                                         <ToggleRow
                                             title={t('config_management.visual.sections.system.request_log')}
                                             description={t('config_management.visual.sections.system.request_log_desc')}
                                             checked={values.requestLog}
                                             disabled={disabled}
                                             onChange={(requestLog) => onChange({ requestLog })}
                                         />
                                     </FieldAnchor>
                                     <FieldAnchor fieldId='usageStatisticsEnabled'>
                                         <ToggleRow
                                             title={t('config_management.visual.sections.system.usage_statistics')}
                                             description={t(
                                                 'config_management.visual.sections.system.usage_statistics_desc')}
                                             checked={values.usageStatisticsEnabled}
                                             disabled={disabled}
                                             onChange={(usageStatisticsEnabled) => onChange({ usageStatisticsEnabled })}
                                         />
                                     </FieldAnchor>
                                     <FieldAnchor fieldId='pprofEnable'>
                                         <ToggleRow
                                             title={t(
                                                 'config_management.visual.sections.system.pprof_enable',
                                                 { defaultValue: '启用 pprof' },
                                             )}
                                             description={t(
                                                 'config_management.visual.sections.system.pprof_enable_desc',
                                                 { defaultValue: '启用后端性能调试 HTTP 服务' },
                                             )}
                                             checked={values.pprofEnable}
                                             disabled={disabled}
                                             tone='warning'
                                             onChange={(pprofEnable) => onChange({ pprofEnable })}
                                         />
                                     </FieldAnchor>
                                 </SectionGrid>

                                 <div className={styles.systemFieldGrid}>
                                     <FieldShell
                                         label={t('system_info.timezone_title', { defaultValue: '显示时区' })}
                                         hint={t('config_management.visual.sections.system.timezone_hint', {
                                             defaultValue: 'Only affects timestamps displayed in the management panel.',
                                         })}
                                     >
                                         <Select
                                             value={timezone}
                                             onChange={setTimezone}
                                             options={timezoneOptions}
                                             disabled={disabled}
                                             className={styles.fieldSelect}
                                         />
                                     </FieldShell>
                                     <FieldAnchor fieldId='logsMaxTotalSizeMb'>
                                         <FieldShell
                                             label={t('config_management.visual.sections.system.logs_max_size')}
                                             hint={t('config_management.visual.sections.system.logs_max_size_hint')}
                                             error={logsMaxSizeError}
                                             meta={logSizeMeta}
                                         >
                                             <input
                                                 className='input'
                                                 type='number'
                                                 placeholder='0'
                                                 value={values.logsMaxTotalSizeMb}
                                                 onChange={(e) => onChange({ logsMaxTotalSizeMb: e.target.value })}
                                                 disabled={disabled}
                                             />
                                         </FieldShell>
                                     </FieldAnchor>
                                     <FieldAnchor fieldId='imageArtifactCacheMaxTotalSizeMb'>
                                         <FieldShell
                                             label={t(
                                                 'config_management.visual.sections.system.image_artifact_cache_max_size',
                                             )}
                                             hint={t(
                                                 'config_management.visual.sections.system.image_artifact_cache_max_size_hint',
                                             )}
                                             error={imageArtifactCacheMaxSizeError}
                                             meta={imageArtifactCacheSizeMeta}
                                         >
                                             <input
                                                 className='input'
                                                 type='number'
                                                 placeholder='10240'
                                                 value={values.imageArtifactCacheMaxTotalSizeMb}
                                                 onChange={(e) => onChange({ imageArtifactCacheMaxTotalSizeMb: e.target.value })}
                                                 disabled={disabled}
                                             />
                                         </FieldShell>
                                     </FieldAnchor>
                                     <FieldAnchor fieldId='imageArtifactCacheRetentionDays'>
                                         <Input
                                             label={t(
                                                 'config_management.visual.sections.system.image_artifact_cache_retention_days',
                                             )}
                                             type='number'
                                             placeholder='7'
                                             value={values.imageArtifactCacheRetentionDays}
                                             onChange={(e) => onChange({ imageArtifactCacheRetentionDays: e.target.value })}
                                             disabled={disabled}
                                             hint={t(
                                                 'config_management.visual.sections.system.image_artifact_cache_retention_hint',
                                             )}
                                             error={imageArtifactCacheRetentionDaysError}
                                         />
                                     </FieldAnchor>
                                     <FieldAnchor fieldId='errorLogsMaxFiles'>
                                         <Input
                                             label={t('config_management.visual.sections.system.error_logs_max_files')}
                                             type='number'
                                             placeholder='10'
                                             value={values.errorLogsMaxFiles}
                                             onChange={(e) => onChange({ errorLogsMaxFiles: e.target.value })}
                                             disabled={disabled}
                                             error={errorLogsMaxFilesError}
                                         />
                                     </FieldAnchor>
                                     <Input
                                         label={t('config_management.visual.sections.system.redis_usage_retention')}
                                         type='number'
                                         placeholder='60'
                                         value={values.redisUsageQueueRetentionSeconds}
                                         onChange={(e) => onChange({ redisUsageQueueRetentionSeconds: e.target.value })}
                                         disabled={disabled}
                                         hint={t('config_management.visual.sections.system.redis_usage_retention_hint')}
                                         error={redisUsageQueueRetentionError}
                                     />
                                     <Input
                                         label={t(
                                             'config_management.visual.sections.system.pprof_addr',
                                             { defaultValue: 'pprof 监听地址' },
                                         )}
                                         placeholder='127.0.0.1:8316'
                                         value={values.pprofAddr}
                                         onChange={(e) => onChange({ pprofAddr: e.target.value })}
                                         disabled={disabled}
                                         hint={t(
                                             'config_management.visual.sections.system.pprof_addr_hint',
                                             { defaultValue: '仅在启用 pprof 时生效' },
                                         )}
                                     />
                                     <FieldAnchor fieldId='usageDataDir'>
                                         <Input
                                             label={t('config_management.visual.sections.system.usage_data_dir')}
                                             placeholder='~/.cli-proxy-api/usage'
                                             value={values.usageDataDir}
                                             onChange={(e) => onChange({ usageDataDir: e.target.value })}
                                             disabled={disabled}
                                             hint={t('config_management.visual.sections.system.usage_data_dir_hint')}
                                         />
                                     </FieldAnchor>
                                     <Input
                                         label={t(
                                             'config_management.visual.sections.system.usage_statistics_file',
                                             { defaultValue: '使用统计旧文件路径' },
                                         )}
                                         placeholder=''
                                         value={values.usageStatisticsFile}
                                         onChange={(e) => onChange({ usageStatisticsFile: e.target.value })}
                                         disabled={disabled}
                                         hint={t(
                                             'config_management.visual.sections.system.usage_statistics_file_hint',
                                             { defaultValue: '对应 usage-statistics-file，留空使用默认数据目录' },
                                         )}
                                     />
                                     <FieldShell
                                         label={t('config_management.visual.sections.system.usage_retention_max_db_size')}
                                         hint={t(
                                             'config_management.visual.sections.system.usage_retention_max_db_size_hint')}
                                         error={usageRetentionMaxDbSizeMbError}
                                         meta={usageDbSizeMeta}
                                     >
                                         <input
                                             className='input'
                                             type='number'
                                             placeholder='0'
                                             value={values.usageRetentionMaxDbSizeMb}
                                             onChange={(e) => onChange({ usageRetentionMaxDbSizeMb: e.target.value })}
                                             disabled={disabled}
                                         />
                                     </FieldShell>
                                     <FieldAnchor fieldId='usageRetentionDays'>
                                         <Input
                                             label={t('config_management.visual.sections.system.usage_retention_days')}
                                             type='number'
                                             placeholder='0'
                                             value={values.usageRetentionDays}
                                             onChange={(e) => onChange({ usageRetentionDays: e.target.value })}
                                             disabled={disabled}
                                             hint={t('config_management.visual.sections.system.usage_retention_hint')}
                                             error={usageRetentionDaysError}
                                         />
                                     </FieldAnchor>
                                     <Input
                                         label={t(
                                             'config_management.visual.sections.system.usage_retention_warning_threshold')}
                                         type='number'
                                         placeholder='80'
                                         value={values.usageRetentionWarningThresholdPct}
                                         onChange={(e) => onChange({ usageRetentionWarningThresholdPct: e.target.value })}
                                         disabled={disabled}
                                         hint={t(
                                             'config_management.visual.sections.system.usage_retention_warning_threshold_hint')}
                                         error={usageRetentionWarningThresholdError}
                                     />
                                     <FieldAnchor fieldId='autoRefreshInterval'>
                                         <Input
                                             label={t('config_management.visual.sections.system.auto_refresh_interval')}
                                             type='number'
                                             placeholder='3'
                                             value={values.autoRefreshInterval}
                                             onChange={(e) => onChange({ autoRefreshInterval: e.target.value })}
                                             disabled={disabled}
                                             hint={t(
                                                 'config_management.visual.sections.system.auto_refresh_interval_hint')}
                                             error={autoRefreshIntervalError}
                                         />
                                     </FieldAnchor>
                                     <Input
                                         label={t('config_management.visual.sections.system.model_refresh_interval')}
                                         type='number'
                                         placeholder='3'
                                         value={values.modelRefreshInterval}
                                         onChange={(e) => onChange({ modelRefreshInterval: e.target.value })}
                                         disabled={disabled}
                                         hint={t('config_management.visual.sections.system.model_refresh_interval_hint')}
                                         error={modelRefreshIntervalError}
                                     />
                                 </div>
                             </SectionStack>
                         </ConfigSection>

                         <ConfigSection
                             id='quota'
                             ref={(node) => {
                                 sectionRefs.current.quota = node
                             }}
                             indexLabel='04'
                             icon={<IconTimer size={16} />}
                             title={t('config_management.visual.sections.quota.title')}
                             description={t('config_management.visual.sections.quota.description')}
                         >
                             <SectionStack>
                                 <SectionGrid>
                                     <ToggleRow
                                         title={t('config_management.visual.sections.quota.switch_project')}
                                         description={t('config_management.visual.sections.quota.switch_project_desc')}
                                         checked={values.quotaSwitchProject}
                                         disabled={disabled}
                                         onChange={(quotaSwitchProject) => onChange({ quotaSwitchProject })}
                                     />
                                     <ToggleRow
                                         title={t('config_management.visual.sections.quota.switch_preview_model')}
                                         description={t(
                                             'config_management.visual.sections.quota.switch_preview_model_desc')}
                                         checked={values.quotaSwitchPreviewModel}
                                         disabled={disabled}
                                         onChange={(quotaSwitchPreviewModel) => onChange({ quotaSwitchPreviewModel })}
                                     />
                                     <FieldAnchor fieldId='quotaAntigravityCredits'>
                                         <ToggleRow
                                             title={t('config_management.visual.sections.quota.antigravity_credits')}
                                             description={t(
                                                 'config_management.visual.sections.quota.antigravity_credits_desc')}
                                             checked={values.quotaAntigravityCredits}
                                             disabled={disabled}
                                             tone='warning'
                                             onChange={(quotaAntigravityCredits) => onChange({ quotaAntigravityCredits })}
                                         />
                                     </FieldAnchor>
                                     <FieldAnchor fieldId='disableCooling'>
                                         <ToggleRow
                                             title={t(
                                                 'config_management.visual.sections.quota.disable_cooling',
                                                 { defaultValue: '停用冷却调度' },
                                             )}
                                             description={t(
                                                 'config_management.visual.sections.quota.disable_cooling_desc',
                                                 { defaultValue: '停用配额或失败后的冷却窗口' },
                                             )}
                                             checked={values.disableCooling}
                                             disabled={disabled}
                                             tone='warning'
                                             onChange={(disableCooling) => onChange({ disableCooling })}
                                         />
                                     </FieldAnchor>
                                 </SectionGrid>
                                 <SectionSubsection
                                     title={t('config_management.visual.sections.quota.refresh_title')}
                                     description={t('config_management.visual.sections.quota.refresh_desc')}
                                 >
                                     <SectionStack>
                                         <FieldAnchor fieldId='quotaRefreshEnabled'>
                                             <ToggleRow
                                                 title={t('config_management.visual.sections.quota.refresh_enabled')}
                                                 description={t(
                                                     'config_management.visual.sections.quota.refresh_enabled_desc')}
                                                 checked={values.quotaRefreshEnabled}
                                                 disabled={disabled}
                                                 onChange={(quotaRefreshEnabled) => onChange({ quotaRefreshEnabled })}
                                             />
                                         </FieldAnchor>
                                         <SectionGrid>
                                             <FieldAnchor fieldId='quotaRefreshInterval'>
                                                 <Input
                                                     label={t('config_management.visual.sections.quota.refresh_interval')}
                                                     type='number'
                                                     placeholder='600'
                                                     value={values.quotaRefreshInterval}
                                                     onChange={(e) => onChange({ quotaRefreshInterval: e.target.value })}
                                                     disabled={disabled}
                                                     hint={t(
                                                         'config_management.visual.sections.quota.refresh_interval_hint')}
                                                     error={quotaRefreshIntervalError}
                                                 />
                                             </FieldAnchor>
                                             <FieldAnchor fieldId='quotaRefreshMaxInterval'>
                                                 <Input
                                                     label={t(
                                                         'config_management.visual.sections.quota.refresh_max_interval')}
                                                     type='number'
                                                     placeholder='1800'
                                                     value={values.quotaRefreshMaxInterval}
                                                     onChange={(e) => onChange({ quotaRefreshMaxInterval: e.target.value })}
                                                     disabled={disabled}
                                                     hint={t(
                                                         'config_management.visual.sections.quota.refresh_max_interval_hint')}
                                                     error={quotaRefreshMaxIntervalError}
                                                 />
                                             </FieldAnchor>
                                         </SectionGrid>
                                     </SectionStack>
                                 </SectionSubsection>
                             </SectionStack>
                         </ConfigSection>

                         <ConfigSection
                             id='streaming'
                             ref={(node) => {
                                 sectionRefs.current.streaming = node
                             }}
                             indexLabel='05'
                             icon={<IconSatellite size={16} />}
                             title={t('config_management.visual.sections.streaming.title')}
                             description={t('config_management.visual.sections.streaming.description')}
                         >
                             <SectionStack>
                                 <SectionGrid>
                                     <FieldAnchor fieldId='streamingKeepaliveSeconds'>
                                         <FieldShell
                                             label={t('config_management.visual.sections.streaming.keepalive_seconds')}
                                             htmlFor={keepaliveInputId}
                                             hint={t('config_management.visual.sections.streaming.keepalive_hint')}
                                             hintId={keepaliveHintId}
                                             error={keepaliveError}
                                             errorId={keepaliveErrorId}
                                         >
                                             <div className={styles.fieldControl}>
                                                 <input
                                                     id={keepaliveInputId}
                                                     className='input'
                                                     type='number'
                                                     placeholder='0'
                                                     value={values.streaming.keepaliveSeconds}
                                                     onChange={(e) =>
                                                         onChange({
                                                                      streaming: {
                                                                          ...values.streaming,
                                                                          keepaliveSeconds: e.target.value,
                                                                      },
                                                                  })
                                                     }
                                                     disabled={disabled}
                                                 />
                                                 {isKeepaliveDisabled ? (
                                                     <span className={styles.inlinePill}>
                                                    {t('config_management.visual.sections.streaming.disabled')}
                                                </span>
                                                 ) : null}
                                             </div>
                                         </FieldShell>
                                     </FieldAnchor>

                                     <FieldAnchor fieldId='streamingBootstrapRetries'>
                                         <Input
                                             label={t('config_management.visual.sections.streaming.bootstrap_retries')}
                                             type='number'
                                             placeholder='1'
                                             value={values.streaming.bootstrapRetries}
                                             onChange={(e) =>
                                                 onChange({
                                                              streaming: {
                                                                  ...values.streaming,
                                                                  bootstrapRetries: e.target.value,
                                                              },
                                                          })
                                             }
                                             disabled={disabled}
                                             hint={t('config_management.visual.sections.streaming.bootstrap_hint')}
                                             error={bootstrapRetriesError}
                                         />
                                     </FieldAnchor>
                                 </SectionGrid>

                                 <SectionGrid>
                                     <FieldAnchor fieldId='streamingNonstreamKeepalive'>
                                         <FieldShell
                                             label={t('config_management.visual.sections.streaming.nonstream_keepalive')}
                                             htmlFor={nonstreamKeepaliveInputId}
                                             hint={t(
                                                 'config_management.visual.sections.streaming.nonstream_keepalive_hint')}
                                             hintId={nonstreamKeepaliveHintId}
                                             error={nonstreamKeepaliveError}
                                             errorId={nonstreamKeepaliveErrorId}
                                         >
                                             <div className={styles.fieldControl}>
                                                 <input
                                                     id={nonstreamKeepaliveInputId}
                                                     className='input'
                                                     type='number'
                                                     placeholder='0'
                                                     value={values.streaming.nonstreamKeepaliveInterval}
                                                     onChange={(e) =>
                                                         onChange({
                                                                      streaming: {
                                                                          ...values.streaming,
                                                                          nonstreamKeepaliveInterval: e.target.value,
                                                                      },
                                                                  })
                                                     }
                                                     disabled={disabled}
                                                 />
                                                 {isNonstreamKeepaliveDisabled ? (
                                                     <span className={styles.inlinePill}>
                                                    {t('config_management.visual.sections.streaming.disabled')}
                                                </span>
                                                 ) : null}
                                             </div>
                                         </FieldShell>
                                     </FieldAnchor>
                                 </SectionGrid>
                             </SectionStack>
                         </ConfigSection>

                         <ConfigSection
                             id='advanced'
                             ref={(node) => {
                                 sectionRefs.current.advanced = node
                             }}
                             indexLabel='06'
                             icon={<IconShield size={16} />}
                             title={t('config_management.visual.sections.advanced.title')}
                             description={t('config_management.visual.sections.advanced.description')}
                         >
                             <SectionStack>
                                 <FieldAnchor fieldId='pluginsEnabled'>
                                     <Collapsible
                                         label={t('config_management.visual.sections.advanced.plugins_title')}
                                         hint={t('config_management.visual.sections.system.plugin_configs_hint')}
                                         defaultOpen={false}
                                     >
                                         <SectionStack>
                                             <ToggleRow
                                                 title={t('config_management.visual.sections.system.plugins_enabled')}
                                                 description={t(
                                                     'config_management.visual.sections.system.plugins_enabled_desc')}
                                                 checked={values.pluginsEnabled}
                                                 disabled={disabled}
                                                 onChange={(pluginsEnabled) => onChange({ pluginsEnabled })}
                                             />
                                             <SectionGrid>
                                                 <FieldAnchor fieldId='pluginsDir'>
                                                     <Input
                                                         label={t('config_management.visual.sections.system.plugins_dir')}
                                                         placeholder='plugins'
                                                         value={values.pluginsDir}
                                                         onChange={(e) => onChange({ pluginsDir: e.target.value })}
                                                         disabled={disabled}
                                                         hint={t(
                                                             'config_management.visual.sections.system.plugins_dir_hint')}
                                                     />
                                                 </FieldAnchor>
                                             </SectionGrid>
                                             <FieldAnchor fieldId='pluginStoreSources'>
                                                 <SectionSubsection
                                                     title={t(
                                                         'config_management.visual.sections.system.plugin_store_sources')}
                                                     description={t(
                                                         'config_management.visual.sections.system.plugin_store_sources_desc')}
                                                 >
                                                     <div className={styles.fieldShell}>
                                                         <StringListEditor
                                                             value={values.pluginStoreSources}
                                                             disabled={disabled}
                                                             placeholder={t(
                                                                 'config_management.visual.sections.system.plugin_store_sources_placeholder',
                                                             )}
                                                             inputAriaLabel={t(
                                                                 'config_management.visual.sections.system.plugin_store_sources_label',
                                                             )}
                                                             onChange={handlePluginStoreSourcesChange}
                                                         />
                                                         <div className={styles.fieldHint}>
                                                             {t('config_management.visual.sections.system.plugin_store_sources_hint')}
                                                         </div>
                                                     </div>
                                                 </SectionSubsection>
                                             </FieldAnchor>
                                             <FieldAnchor fieldId='pluginStoreAuth'>
                                                 <SectionSubsection
                                                     title={t(
                                                         'config_management.visual.sections.system.plugin_store_auth')}
                                                     description={t(
                                                         'config_management.visual.sections.system.plugin_store_auth_desc')}
                                                 >
                                                     <div className={styles.fieldShell}>
                                                         <div className={styles.fieldHint}>
                                                             {t('config_management.visual.sections.system.plugin_store_auth_hint')}
                                                         </div>
                                                         <PluginStoreAuthEditor
                                                             value={values.pluginStoreAuth}
                                                             disabled={disabled}
                                                             onChange={handlePluginStoreAuthChange}
                                                         />
                                                     </div>
                                                 </SectionSubsection>
                                             </FieldAnchor>
                                             <FieldAnchor fieldId='pluginConfigs'>
                                                 <TextAreaField
                                                     label={t(
                                                         'config_management.visual.sections.system.plugin_configs',
                                                         { defaultValue: '插件实例配置' },
                                                     )}
                                                     value={values.pluginConfigsText}
                                                     placeholder={'{}'}
                                                     disabled={disabled}
                                                     hint={t(
                                                         'config_management.visual.sections.system.plugin_configs_hint',
                                                         { defaultValue: '对应 plugins.configs，使用 YAML map 格式' },
                                                     )}
                                                     onChange={(pluginConfigsText) => onChange({ pluginConfigsText })}
                                                 />
                                             </FieldAnchor>
                                         </SectionStack>
                                     </Collapsible>
                                 </FieldAnchor>

                                 <FieldAnchor fieldId='providerConfig'>
                                     <Collapsible
                                         label={t(
                                             'config_management.visual.sections.network.provider_advanced',
                                             { defaultValue: '供应商高级配置' },
                                         )}
                                         hint={t(
                                             'config_management.visual.sections.network.provider_advanced_desc',
                                             { defaultValue: '复杂数组和映射使用 YAML 格式直接暴露，保存后写回源码配置对应路径' },
                                         )}
                                         defaultOpen={false}
                                     >
                                         <SectionStack>
                                             <TextAreaField
                                                 label={t(
                                                     'config_management.visual.sections.network.provider_keys',
                                                     { defaultValue: '供应商 Key 与 OpenAI 兼容配置' },
                                                 )}
                                                 value={values.providerConfigText}
                                                 placeholder={'gemini-api-key: []\ncodex-api-key: []\nclaude-api-key: []\nvertex-api-key: []\nopenai-compatibility: []'}
                                                 disabled={disabled}
                                                 onChange={(providerConfigText) => onChange({ providerConfigText })}
                                             />
                                             <FieldAnchor fieldId='oauthExcludedModels'>
                                                 <TextAreaField
                                                     label={t(
                                                         'config_management.visual.sections.network.oauth_excluded_models',
                                                         { defaultValue: 'OAuth 排除模型' },
                                                     )}
                                                     value={values.oauthExcludedModelsText}
                                                     placeholder={'{}'}
                                                     disabled={disabled}
                                                     hint={t(
                                                         'config_management.visual.sections.network.oauth_excluded_models_hint',
                                                         { defaultValue: '对应 oauth-excluded-models，按 provider 写模型禁用列表' },
                                                     )}
                                                     onChange={(oauthExcludedModelsText) => onChange({ oauthExcludedModelsText })}
                                                 />
                                             </FieldAnchor>
                                             <FieldAnchor fieldId='oauthModelAlias'>
                                                 <TextAreaField
                                                     label={t(
                                                         'config_management.visual.sections.network.oauth_model_alias',
                                                         { defaultValue: 'OAuth 模型别名' },
                                                     )}
                                                     value={values.oauthModelAliasText}
                                                     placeholder={'{}'}
                                                     disabled={disabled}
                                                     hint={t(
                                                         'config_management.visual.sections.network.oauth_model_alias_hint',
                                                         { defaultValue: '对应 oauth-model-alias，按 provider 写 name/alias/fork 列表' },
                                                     )}
                                                     onChange={(oauthModelAliasText) => onChange({ oauthModelAliasText })}
                                                 />
                                             </FieldAnchor>
                                         </SectionStack>
                                     </Collapsible>
                                 </FieldAnchor>

                                 <FieldAnchor fieldId='codexIdentityConfuse'>
                                     <Collapsible
                                         label={t('config_management.visual.sections.advanced.signature_title')}
                                         defaultOpen={false}
                                     >
                                         <SectionStack>
                                             <ToggleRow
                                                 title={t(
                                                     'config_management.visual.sections.network.codex_identity_confuse',
                                                     { defaultValue: 'Codex 身份混淆' },
                                                 )}
                                                 description={t(
                                                     'config_management.visual.sections.network.codex_identity_confuse_desc',
                                                     { defaultValue: '对应 codex.identity-confuse' },
                                                 )}
                                                 checked={values.codexIdentityConfuse}
                                                 disabled={disabled}
                                                 tone='warning'
                                                 onChange={(codexIdentityConfuse) => onChange({ codexIdentityConfuse })}
                                             />
                                             <FieldAnchor fieldId='codexHeaderDefaults'>
                                                 <TextAreaField
                                                     label={t(
                                                         'config_management.visual.sections.network.codex_header_defaults',
                                                         { defaultValue: 'Codex 默认请求头' },
                                                     )}
                                                     value={values.codexHeaderDefaultsText}
                                                     placeholder={'user-agent: ""\nbeta-features: ""'}
                                                     disabled={disabled}
                                                     onChange={(codexHeaderDefaultsText) => onChange({ codexHeaderDefaultsText })}
                                                 />
                                             </FieldAnchor>
                                             <FieldAnchor fieldId='claudeHeaderDefaults'>
                                                 <TextAreaField
                                                     label={t(
                                                         'config_management.visual.sections.network.claude_header_defaults',
                                                         { defaultValue: 'Claude 默认请求头' },
                                                     )}
                                                     value={values.claudeHeaderDefaultsText}
                                                     placeholder={'user-agent: ""\npackage-version: ""\nruntime-version: ""\nos: ""\narch: ""\ntimeout: ""'}
                                                     disabled={disabled}
                                                     onChange={(claudeHeaderDefaultsText) => onChange({ claudeHeaderDefaultsText })}
                                                 />
                                             </FieldAnchor>
                                         </SectionStack>
                                     </Collapsible>
                                 </FieldAnchor>
                             </SectionStack>
                         </ConfigSection>

                         <ConfigSection
                             id='payload'
                             ref={(node) => {
                                 sectionRefs.current.payload = node
                             }}
                             indexLabel='07'
                             icon={<IconCode size={16} />}
                             title={t('config_management.visual.sections.payload.title')}
                             description={t('config_management.visual.sections.payload.description')}
                         >
                             <SectionStack>
                                 <FieldMeta tone='warning'>
                                     {t('config_management.visual.sections.payload.advanced_hint')}
                                 </FieldMeta>
                                 <FieldAnchor fieldId='payloadDefaultRules'>
                                     <Collapsible
                                         label={t('config_management.visual.sections.payload.default_rules')}
                                         hint={t('config_management.visual.sections.payload.default_rules_desc')}
                                         defaultOpen={hasPayloadValidationErrors}
                                     >
                                         <PayloadRulesEditor
                                             value={values.payloadDefaultRules}
                                             disabled={disabled}
                                             onChange={handlePayloadDefaultRulesChange}
                                         />
                                     </Collapsible>
                                 </FieldAnchor>

                                 <FieldAnchor fieldId='payloadDefaultRawRules'>
                                     <Collapsible
                                         label={t('config_management.visual.sections.payload.default_raw_rules')}
                                         hint={t('config_management.visual.sections.payload.default_raw_rules_desc')}
                                         defaultOpen={hasPayloadValidationErrors}
                                     >
                                         <PayloadRulesEditor
                                             value={values.payloadDefaultRawRules}
                                             disabled={disabled}
                                             rawJsonValues
                                             onChange={handlePayloadDefaultRawRulesChange}
                                         />
                                     </Collapsible>
                                 </FieldAnchor>

                                 <FieldAnchor fieldId='payloadOverrideRules'>
                                     <Collapsible
                                         label={t('config_management.visual.sections.payload.override_rules')}
                                         hint={t('config_management.visual.sections.payload.override_rules_desc')}
                                         defaultOpen={hasPayloadValidationErrors}
                                     >
                                         <PayloadRulesEditor
                                             value={values.payloadOverrideRules}
                                             disabled={disabled}
                                             protocolFirst
                                             onChange={handlePayloadOverrideRulesChange}
                                         />
                                     </Collapsible>
                                 </FieldAnchor>

                                 <FieldAnchor fieldId='payloadOverrideRawRules'>
                                     <Collapsible
                                         label={t('config_management.visual.sections.payload.override_raw_rules')}
                                         hint={t('config_management.visual.sections.payload.override_raw_rules_desc')}
                                         defaultOpen={hasPayloadValidationErrors}
                                     >
                                         <PayloadRulesEditor
                                             value={values.payloadOverrideRawRules}
                                             disabled={disabled}
                                             protocolFirst
                                             rawJsonValues
                                             onChange={handlePayloadOverrideRawRulesChange}
                                         />
                                     </Collapsible>
                                 </FieldAnchor>

                                 <FieldAnchor fieldId='payloadFilterRules'>
                                     <Collapsible
                                         label={t('config_management.visual.sections.payload.filter_rules')}
                                         hint={t('config_management.visual.sections.payload.filter_rules_desc')}
                                         defaultOpen={hasPayloadValidationErrors}
                                     >
                                         <PayloadFilterRulesEditor
                                             value={values.payloadFilterRules}
                                             disabled={disabled}
                                             onChange={handlePayloadFilterRulesChange}
                                         />
                                     </Collapsible>
                                 </FieldAnchor>
                             </SectionStack>
                         </ConfigSection>
                     </div>
                 </div>
             )}
        </div>
    )
}
