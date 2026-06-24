import {ConfigSection} from '@/components/config/ConfigSection'
import {
    IconCode,
    IconDiamond,
    IconKey,
    type IconProps,
    IconSatellite,
    IconSettings,
    IconShield,
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
    VisualConfigFieldPath,
    VisualConfigRuntimeInfo,
    VisualConfigValidationErrorCode,
    VisualConfigValidationErrors,
    VisualConfigValues,
} from '@/types/visualConfig'
import {formatFileSize} from '@/utils/format'
import {type ComponentType, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './VisualConfigEditor.module.scss'
import {ApiKeysCardEditor, PayloadFilterRulesEditor, PayloadRulesEditor} from './VisualConfigEditorBlocks'

type VisualSectionId = 'server' | 'tls' | 'remote' | 'auth' | 'system' | 'network' | 'quota' | 'streaming' | 'payload'

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
    const { t }                                 = useTranslation()
    const timezone                              = useTimezoneStore((state) => state.timezone)
    const setTimezone                           = useTimezoneStore((state) => state.setTimezone)
    const timezoneOptions                       = useMemo(
        () => TIMEZONE_OPTIONS.map((tz) => ({
            value: tz.value,
            label: tz.value === '' ? t('system_info.timezone_system', { defaultValue: '系统（浏览器默认）' }) : tz.label,
        })),
        [t],
    )
    const routingStrategyLabelId                = useId()
    const routingStrategyHintId                 = `${routingStrategyLabelId}-hint`
    const keepaliveInputId                      = useId()
    const keepaliveHintId                       = `${keepaliveInputId}-hint`
    const keepaliveErrorId                      = `${keepaliveInputId}-error`
    const nonstreamKeepaliveInputId             = useId()
    const nonstreamKeepaliveHintId              = `${nonstreamKeepaliveInputId}-hint`
    const nonstreamKeepaliveErrorId             = `${nonstreamKeepaliveInputId}-error`
    const [activeSectionId, setActiveSectionId] = useState<VisualSectionId>('server')
    const workspaceRef                          = useRef<HTMLDivElement | null>(null)
    const sectionRefs                           = useRef<Partial<Record<VisualSectionId, HTMLElement | null>>>({})
    const sectionJumpLockUntilRef               = useRef(0)

    const isKeepaliveDisabled          = values.streaming.keepaliveSeconds ===
                                         '' ||
                                         values.streaming.keepaliveSeconds ===
                                         '0'
    const isNonstreamKeepaliveDisabled =
              values.streaming.nonstreamKeepaliveInterval === '' || values.streaming.nonstreamKeepaliveInterval === '0'

    const portError                           = getValidationMessage(t, validationErrors?.port)
    const tlsHttpRedirectPortError            = getValidationMessage(t, validationErrors?.tlsHttpRedirectPort)
    const logsMaxSizeError                    = getValidationMessage(t, validationErrors?.logsMaxTotalSizeMb)
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
                id: 'server',
                title: t('config_management.visual.sections.server.title'),
                description: t('config_management.visual.sections.server.description'),
                icon: IconSettings,
                errorCount: countErrors(['port']),
            },
            {
                id: 'tls',
                title: t('config_management.visual.sections.tls.title'),
                description: t('config_management.visual.sections.tls.description'),
                icon: IconShield,
                errorCount: 0,
            },
            {
                id: 'remote',
                title: t('config_management.visual.sections.remote.title'),
                description: t('config_management.visual.sections.remote.description'),
                icon: IconSatellite,
                errorCount: 0,
            },
            {
                id: 'auth',
                title: t('config_management.visual.sections.auth.title'),
                description: t('config_management.visual.sections.auth.description'),
                icon: IconKey,
                errorCount: 0,
            },
            {
                id: 'system',
                title: t('config_management.visual.sections.system.title'),
                description: t('config_management.visual.sections.system.description'),
                icon: IconDiamond,
                errorCount: countErrors([
                                            'logsMaxTotalSizeMb',
                                            'errorLogsMaxFiles',
                                            'usageRetentionDays',
                                            'usageRetentionMaxDbSizeMb',
                                            'usageRetentionWarningThresholdPct',
                                            'autoRefreshInterval',
                                            'modelRefreshInterval',
                                        ]),
            },
            {
                id: 'network',
                title: t('config_management.visual.sections.network.title'),
                description: t('config_management.visual.sections.network.description'),
                icon: IconTrendingUp,
                errorCount: countErrors(['requestRetry', 'maxRetryCredentials', 'maxRetryInterval']),
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
                id: 'payload',
                title: t('config_management.visual.sections.payload.title'),
                description: t('config_management.visual.sections.payload.description'),
                icon: IconCode,
                errorCount: hasPayloadValidationErrors ? 1 : 0,
            },
        ],
        [countErrors, hasPayloadValidationErrors, t],
    )

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
    }, [updateActiveSection])

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
            <div ref={workspaceRef} className={styles.workspace}>
                <aside className={styles.sidebar}>
                    <div className={styles.sidebarRail}>{navContent}</div>
                </aside>

                <div className={styles.sections}>
                    <ConfigSection
                        id='server'
                        ref={(node) => {
                            sectionRefs.current.server = node
                        }}
                        indexLabel='01'
                        icon={<IconSettings size={16} />}
                        title={t('config_management.visual.sections.server.title')}
                        description={t('config_management.visual.sections.server.description')}
                    >
                        <SectionGrid>
                            <Input
                                label={t('config_management.visual.sections.server.host')}
                                placeholder='127.0.0.1'
                                value={values.host}
                                onChange={(e) => onChange({ host: e.target.value })}
                                disabled={disabled}
                                hint={t('config_management.visual.sections.server.host_hint')}
                            />
                            <Input
                                label={t('config_management.visual.sections.server.port')}
                                type='number'
                                placeholder='8317'
                                value={values.port}
                                onChange={(e) => onChange({ port: e.target.value })}
                                disabled={disabled}
                                error={portError}
                            />
                        </SectionGrid>
                    </ConfigSection>

                    <ConfigSection
                        id='tls'
                        ref={(node) => {
                            sectionRefs.current.tls = node
                        }}
                        indexLabel='02'
                        icon={<IconShield size={16} />}
                        title={t('config_management.visual.sections.tls.title')}
                        description={t('config_management.visual.sections.tls.description')}
                    >
                        <SectionStack>
                            <ToggleRow
                                title={t('config_management.visual.sections.tls.enable')}
                                description={t('config_management.visual.sections.tls.enable_desc')}
                                checked={values.tlsEnable}
                                disabled={disabled}
                                onChange={(tlsEnable) => onChange({ tlsEnable })}
                            />

                            <Divider />
                            <SectionGrid>
                                <Input
                                    label={t('config_management.visual.sections.tls.cert')}
                                    placeholder='/path/to/cert.pem'
                                    value={values.tlsCert}
                                    onChange={(e) => onChange({ tlsCert: e.target.value })}
                                    disabled={disabled}
                                />
                                <Input
                                    label={t('config_management.visual.sections.tls.key')}
                                    placeholder='/path/to/key.pem'
                                    value={values.tlsKey}
                                    onChange={(e) => onChange({ tlsKey: e.target.value })}
                                    disabled={disabled}
                                />
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
                            </SectionGrid>
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
                        </SectionStack>
                    </ConfigSection>

                    <ConfigSection
                        id='remote'
                        ref={(node) => {
                            sectionRefs.current.remote = node
                        }}
                        indexLabel='03'
                        icon={<IconSatellite size={16} />}
                        title={t('config_management.visual.sections.remote.title')}
                        description={t('config_management.visual.sections.remote.description')}
                    >
                        <SectionStack>
                            <ToggleRow
                                title={t('config_management.visual.sections.remote.allow_remote')}
                                description={t('config_management.visual.sections.remote.allow_remote_desc')}
                                checked={values.rmAllowRemote}
                                disabled={disabled}
                                tone='warning'
                                onChange={(rmAllowRemote) => onChange({ rmAllowRemote })}
                            />
                            <ToggleRow
                                title={t('config_management.visual.sections.remote.disable_panel')}
                                description={t('config_management.visual.sections.remote.disable_panel_desc')}
                                checked={values.rmDisableControlPanel}
                                disabled={disabled}
                                onChange={(rmDisableControlPanel) => onChange({ rmDisableControlPanel })}
                            />
                            <ToggleRow
                                title={t('config_management.visual.sections.remote.auto_update_panel', {
                                    defaultValue: 'Auto-install panel updates',
                                })}
                                description={t('config_management.visual.sections.remote.auto_update_panel_desc', {
                                    defaultValue: 'Automatically download and install detected panel updates',
                                })}
                                checked={values.rmAutoUpdatePanel}
                                disabled={disabled}
                                onChange={(rmAutoUpdatePanel) => onChange({ rmAutoUpdatePanel })}
                            />
                            <ToggleRow
                                title={t('config_management.visual.sections.remote.auto_update_cpa', {
                                    defaultValue: 'Auto-update backend',
                                })}
                                description={t('config_management.visual.sections.remote.auto_update_cpa_desc', {
                                    defaultValue: 'Automatically download and install detected CPA backend updates',
                                })}
                                checked={values.rmAutoUpdateCPA}
                                disabled={disabled}
                                onChange={(rmAutoUpdateCPA) => onChange({ rmAutoUpdateCPA })}
                            />
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
                                    value={values.rmAutoCheckUpdate ? values.rmCheckInterval || '180' : '0'}
                                    options={[
                                        {
                                            value: '0',
                                            label: t('config_management.visual.sections.remote.check_interval_off', {
                                                defaultValue: 'Off',
                                            }),
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
                                            onChange({ rmAutoCheckUpdate: true, rmCheckInterval: nextValue })
                                        }
                                    }}
                                />
                            </FieldShell>
                            <SectionGrid>
                                <Input
                                    label={t('config_management.visual.sections.remote.secret_key')}
                                    type='password'
                                    placeholder={t('config_management.visual.sections.remote.secret_key_placeholder')}
                                    value={values.rmSecretKey}
                                    onChange={(e) => onChange({ rmSecretKey: e.target.value })}
                                    disabled={disabled}
                                    hint={t('config_management.visual.sections.remote.secret_key_hint')}
                                />
                            </SectionGrid>
                            <SectionSubsection
                                title={t('config_management.visual.sections.remote.update_source')}
                                description={t('config_management.visual.sections.remote.update_source_desc')}
                            >
                                <SectionGrid>
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
                            </SectionSubsection>
                        </SectionStack>
                    </ConfigSection>

                    <ConfigSection
                        id='auth'
                        ref={(node) => {
                            sectionRefs.current.auth = node
                        }}
                        indexLabel='04'
                        icon={<IconKey size={16} />}
                        title={t('config_management.visual.sections.auth.title')}
                        description={t('config_management.visual.sections.auth.description')}
                    >
                        <SectionStack>
                            <Input
                                label={t('config_management.visual.sections.auth.auth_dir')}
                                placeholder='~/.cli-proxy-api'
                                value={values.authDir}
                                onChange={(e) => onChange({ authDir: e.target.value })}
                                disabled={disabled}
                                hint={t('config_management.visual.sections.auth.auth_dir_hint')}
                            />
                            <div className={styles.subsection}>
                                <ApiKeysCardEditor
                                    value={values.apiKeysText}
                                    modelRules={values.apiKeyRules}
                                    disabled={disabled}
                                    onChange={handleApiKeysTextChange}
                                    onModelRulesChange={handleApiKeyRulesChange}
                                />
                            </div>
                            <TextAreaField
                                label={t(
                                    'config_management.visual.sections.auth.api_key_aliases',
                                    { defaultValue: 'API Key 别名' },
                                )}
                                value={values.apiKeyAliasesText}
                                placeholder={'{}'}
                                disabled={disabled}
                                hint={t(
                                    'config_management.visual.sections.auth.api_key_aliases_hint',
                                    { defaultValue: '对应源码配置 api-key-aliases，使用 YAML map 格式' },
                                )}
                                onChange={(apiKeyAliasesText) => onChange({ apiKeyAliasesText })}
                            />
                        </SectionStack>
                    </ConfigSection>

                    <ConfigSection
                        id='system'
                        ref={(node) => {
                            sectionRefs.current.system = node
                        }}
                        indexLabel='05'
                        icon={<IconDiamond size={16} />}
                        title={t('config_management.visual.sections.system.title')}
                        description={t('config_management.visual.sections.system.description')}
                    >
                        <SectionStack>
                            <SectionGrid>
                                <ToggleRow
                                    title={t('config_management.visual.sections.system.debug')}
                                    description={t('config_management.visual.sections.system.debug_desc')}
                                    checked={values.debug}
                                    disabled={disabled}
                                    onChange={(debug) => onChange({ debug })}
                                />
                                <ToggleRow
                                    title={t('config_management.visual.sections.system.commercial_mode')}
                                    description={t('config_management.visual.sections.system.commercial_mode_desc')}
                                    checked={values.commercialMode}
                                    disabled={disabled}
                                    onChange={(commercialMode) => onChange({ commercialMode })}
                                />
                                <ToggleRow
                                    title={t('config_management.visual.sections.system.logging_to_file')}
                                    description={t('config_management.visual.sections.system.logging_to_file_desc')}
                                    checked={values.loggingToFile}
                                    disabled={disabled}
                                    onChange={(loggingToFile) => onChange({ loggingToFile })}
                                />
                                <ToggleRow
                                    title={t('config_management.visual.sections.system.request_log')}
                                    description={t('config_management.visual.sections.system.request_log_desc')}
                                    checked={values.requestLog}
                                    disabled={disabled}
                                    onChange={(requestLog) => onChange({ requestLog })}
                                />
                                <ToggleRow
                                    title={t('config_management.visual.sections.system.usage_statistics')}
                                    description={t('config_management.visual.sections.system.usage_statistics_desc')}
                                    checked={values.usageStatisticsEnabled}
                                    disabled={disabled}
                                    onChange={(usageStatisticsEnabled) => onChange({ usageStatisticsEnabled })}
                                />
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
                                <ToggleRow
                                    title={t('config_management.visual.sections.system.plugins_enabled')}
                                    description={t('config_management.visual.sections.system.plugins_enabled_desc')}
                                    checked={values.pluginsEnabled}
                                    disabled={disabled}
                                    onChange={(pluginsEnabled) => onChange({ pluginsEnabled })}
                                />
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
                                <Input
                                    label={t('config_management.visual.sections.system.error_logs_max_files')}
                                    type='number'
                                    placeholder='10'
                                    value={values.errorLogsMaxFiles}
                                    onChange={(e) => onChange({ errorLogsMaxFiles: e.target.value })}
                                    disabled={disabled}
                                    error={errorLogsMaxFilesError}
                                />
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
                                <Input
                                    label={t('config_management.visual.sections.system.usage_data_dir')}
                                    placeholder='~/.cli-proxy-api/usage'
                                    value={values.usageDataDir}
                                    onChange={(e) => onChange({ usageDataDir: e.target.value })}
                                    disabled={disabled}
                                    hint={t('config_management.visual.sections.system.usage_data_dir_hint')}
                                />
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
                                <Input
                                    label={t('config_management.visual.sections.system.plugins_dir')}
                                    placeholder='plugins'
                                    value={values.pluginsDir}
                                    onChange={(e) => onChange({ pluginsDir: e.target.value })}
                                    disabled={disabled}
                                    hint={t('config_management.visual.sections.system.plugins_dir_hint')}
                                />
                                <FieldShell
                                    label={t('config_management.visual.sections.system.usage_retention_max_db_size')}
                                    hint={t('config_management.visual.sections.system.usage_retention_max_db_size_hint')}
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
                                <Input
                                    label={t('config_management.visual.sections.system.auto_refresh_interval')}
                                    type='number'
                                    placeholder='3'
                                    value={values.autoRefreshInterval}
                                    onChange={(e) => onChange({ autoRefreshInterval: e.target.value })}
                                    disabled={disabled}
                                    hint={t('config_management.visual.sections.system.auto_refresh_interval_hint')}
                                    error={autoRefreshIntervalError}
                                />
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
                        </SectionStack>
                    </ConfigSection>

                    <ConfigSection
                        id='network'
                        ref={(node) => {
                            sectionRefs.current.network = node
                        }}
                        indexLabel='06'
                        icon={<IconTrendingUp size={16} />}
                        title={t('config_management.visual.sections.network.title')}
                        description={t('config_management.visual.sections.network.description')}
                    >
                        <SectionStack>
                            <SectionGrid>
                                <Input
                                    label={t('config_management.visual.sections.network.proxy_url')}
                                    placeholder='socks5://user:pass@127.0.0.1:1080/'
                                    value={values.proxyUrl}
                                    onChange={(e) => onChange({ proxyUrl: e.target.value })}
                                    disabled={disabled}
                                />
                                <Input
                                    label={t('config_management.visual.sections.network.request_retry')}
                                    type='number'
                                    placeholder='3'
                                    value={values.requestRetry}
                                    onChange={(e) => onChange({ requestRetry: e.target.value })}
                                    disabled={disabled}
                                    error={requestRetryError}
                                />
                                <Input
                                    label={t('config_management.visual.sections.network.max_retry_credentials')}
                                    type='number'
                                    placeholder='0'
                                    value={values.maxRetryCredentials}
                                    onChange={(e) => onChange({ maxRetryCredentials: e.target.value })}
                                    disabled={disabled}
                                    hint={t('config_management.visual.sections.network.max_retry_credentials_hint')}
                                    error={maxRetryCredentialsError}
                                />
                                <Input
                                    label={t('config_management.visual.sections.network.max_retry_interval')}
                                    type='number'
                                    placeholder='30'
                                    value={values.maxRetryInterval}
                                    onChange={(e) => onChange({ maxRetryInterval: e.target.value })}
                                    disabled={disabled}
                                    error={maxRetryIntervalError}
                                />
                                <Input
                                    label={t('config_management.visual.sections.network.auth_auto_refresh_workers')}
                                    type='number'
                                    placeholder='16'
                                    value={values.authAutoRefreshWorkers}
                                    onChange={(e) => onChange({ authAutoRefreshWorkers: e.target.value })}
                                    disabled={disabled}
                                    hint={t('config_management.visual.sections.network.auth_auto_refresh_workers_hint')}
                                    error={authAutoRefreshWorkersError}
                                />
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
                                <Input
                                    label={t('config_management.visual.sections.network.cors_allowed_origins')}
                                    placeholder='https://example.com, https://admin.example.com'
                                    value={values.corsAllowedOrigins}
                                    onChange={(e) => onChange({ corsAllowedOrigins: e.target.value })}
                                    disabled={disabled}
                                    hint={t('config_management.visual.sections.network.cors_allowed_origins_hint')}
                                />
                                <Input
                                    label={t('config_management.visual.sections.network.session_affinity_ttl')}
                                    placeholder='1h'
                                    value={values.routingSessionAffinityTTL}
                                    onChange={(e) => onChange({ routingSessionAffinityTTL: e.target.value })}
                                    disabled={disabled}
                                    hint={t('config_management.visual.sections.network.session_affinity_ttl_hint')}
                                />
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
                            </SectionGrid>

                            <SectionGrid>
                                <ToggleRow
                                    title={t('config_management.visual.sections.network.force_model_prefix')}
                                    description={t('config_management.visual.sections.network.force_model_prefix_desc')}
                                    checked={values.forceModelPrefix}
                                    disabled={disabled}
                                    onChange={(forceModelPrefix) => onChange({ forceModelPrefix })}
                                />
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
                                    description={t('config_management.visual.sections.network.passthrough_headers_desc')}
                                    checked={values.passthroughHeaders}
                                    disabled={disabled}
                                    onChange={(passthroughHeaders) => onChange({ passthroughHeaders })}
                                />
                                <FieldShell
                                    label={t('config_management.visual.sections.network.disable_image_generation')}
                                    hint={t('config_management.visual.sections.network.disable_image_generation_hint')}
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
                                        ]}
                                        disabled={disabled}
                                        onChange={(disableImageGeneration) => onChange({ disableImageGeneration: disableImageGeneration as VisualConfigValues['disableImageGeneration'] })}
                                    />
                                </FieldShell>
                                <ToggleRow
                                    title={t('config_management.visual.sections.network.session_affinity')}
                                    description={t('config_management.visual.sections.network.session_affinity_desc')}
                                    checked={values.routingSessionAffinity}
                                    disabled={disabled}
                                    onChange={(routingSessionAffinity) => onChange({ routingSessionAffinity })}
                                />
                                <ToggleRow
                                    title={t('config_management.visual.sections.network.ws_auth')}
                                    description={t('config_management.visual.sections.network.ws_auth_desc')}
                                    checked={values.wsAuth}
                                    disabled={disabled}
                                    onChange={(wsAuth) => onChange({ wsAuth })}
                                />
                                <ToggleRow
                                    title={t('config_management.visual.sections.network.allow_query_auth')}
                                    description={t('config_management.visual.sections.network.allow_query_auth_desc')}
                                    checked={values.allowQueryAuth}
                                    disabled={disabled}
                                    tone='danger'
                                    onChange={(allowQueryAuth) => onChange({ allowQueryAuth })}
                                />
                            </SectionGrid>
                            <SectionSubsection
                                title={t(
                                    'config_management.visual.sections.network.provider_advanced',
                                    { defaultValue: '供应商高级配置' },
                                )}
                                description={t(
                                    'config_management.visual.sections.network.provider_advanced_desc',
                                    { defaultValue: '复杂数组和映射使用 YAML 格式直接暴露，保存后写回源码配置对应路径' },
                                )}
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
                                    <TextAreaField
                                        label={t(
                                            'config_management.visual.sections.network.ampcode',
                                            { defaultValue: 'AmpCode 配置' },
                                        )}
                                        value={values.ampcodeText}
                                        placeholder={'upstream-url: ""\nupstream-api-key: ""\nupstream-api-keys: []\nrestrict-management-to-localhost: false\nmodel-mappings: []\nforce-model-mappings: false'}
                                        disabled={disabled}
                                        onChange={(ampcodeText) => onChange({ ampcodeText })}
                                    />
                                </SectionStack>
                            </SectionSubsection>
                        </SectionStack>
                    </ConfigSection>

                    <ConfigSection
                        id='quota'
                        ref={(node) => {
                            sectionRefs.current.quota = node
                        }}
                        indexLabel='07'
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
                                    description={t('config_management.visual.sections.quota.switch_preview_model_desc')}
                                    checked={values.quotaSwitchPreviewModel}
                                    disabled={disabled}
                                    onChange={(quotaSwitchPreviewModel) => onChange({ quotaSwitchPreviewModel })}
                                />
                                <ToggleRow
                                    title={t('config_management.visual.sections.quota.antigravity_credits')}
                                    description={t('config_management.visual.sections.quota.antigravity_credits_desc')}
                                    checked={values.quotaAntigravityCredits}
                                    disabled={disabled}
                                    tone='warning'
                                    onChange={(quotaAntigravityCredits) => onChange({ quotaAntigravityCredits })}
                                />
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
                            </SectionGrid>
                            <SectionSubsection
                                title={t('config_management.visual.sections.quota.refresh_title')}
                                description={t('config_management.visual.sections.quota.refresh_desc')}
                            >
                                <SectionStack>
                                    <ToggleRow
                                        title={t('config_management.visual.sections.quota.refresh_enabled')}
                                        description={t('config_management.visual.sections.quota.refresh_enabled_desc')}
                                        checked={values.quotaRefreshEnabled}
                                        disabled={disabled}
                                        onChange={(quotaRefreshEnabled) => onChange({ quotaRefreshEnabled })}
                                    />
                                    <SectionGrid>
                                        <Input
                                            label={t('config_management.visual.sections.quota.refresh_interval')}
                                            type='number'
                                            placeholder='600'
                                            value={values.quotaRefreshInterval}
                                            onChange={(e) => onChange({ quotaRefreshInterval: e.target.value })}
                                            disabled={disabled}
                                            hint={t('config_management.visual.sections.quota.refresh_interval_hint')}
                                            error={quotaRefreshIntervalError}
                                        />
                                        <Input
                                            label={t('config_management.visual.sections.quota.refresh_max_interval')}
                                            type='number'
                                            placeholder='1800'
                                            value={values.quotaRefreshMaxInterval}
                                            onChange={(e) => onChange({ quotaRefreshMaxInterval: e.target.value })}
                                            disabled={disabled}
                                            hint={t('config_management.visual.sections.quota.refresh_max_interval_hint')}
                                            error={quotaRefreshMaxIntervalError}
                                        />
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
                        indexLabel='08'
                        icon={<IconSatellite size={16} />}
                        title={t('config_management.visual.sections.streaming.title')}
                        description={t('config_management.visual.sections.streaming.description')}
                    >
                        <SectionStack>
                            <SectionGrid>
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
                            </SectionGrid>

                            <SectionGrid>
                                <FieldShell
                                    label={t('config_management.visual.sections.streaming.nonstream_keepalive')}
                                    htmlFor={nonstreamKeepaliveInputId}
                                    hint={t('config_management.visual.sections.streaming.nonstream_keepalive_hint')}
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
                            </SectionGrid>
                        </SectionStack>
                    </ConfigSection>

                    <ConfigSection
                        id='payload'
                        ref={(node) => {
                            sectionRefs.current.payload = node
                        }}
                        indexLabel='09'
                        icon={<IconCode size={16} />}
                        title={t('config_management.visual.sections.payload.title')}
                        description={t('config_management.visual.sections.payload.description')}
                    >
                        <SectionStack>
                            <FieldMeta tone='warning'>
                                {t('config_management.visual.sections.payload.advanced_hint')}
                            </FieldMeta>
                            <SectionSubsection
                                title={t('config_management.visual.sections.payload.default_rules')}
                                description={t('config_management.visual.sections.payload.default_rules_desc')}
                            >
                                <PayloadRulesEditor
                                    value={values.payloadDefaultRules}
                                    disabled={disabled}
                                    onChange={handlePayloadDefaultRulesChange}
                                />
                            </SectionSubsection>

                            <SectionSubsection
                                title={t('config_management.visual.sections.payload.default_raw_rules')}
                                description={t('config_management.visual.sections.payload.default_raw_rules_desc')}
                            >
                                <PayloadRulesEditor
                                    value={values.payloadDefaultRawRules}
                                    disabled={disabled}
                                    rawJsonValues
                                    onChange={handlePayloadDefaultRawRulesChange}
                                />
                            </SectionSubsection>

                            <SectionSubsection
                                title={t('config_management.visual.sections.payload.override_rules')}
                                description={t('config_management.visual.sections.payload.override_rules_desc')}
                            >
                                <PayloadRulesEditor
                                    value={values.payloadOverrideRules}
                                    disabled={disabled}
                                    protocolFirst
                                    onChange={handlePayloadOverrideRulesChange}
                                />
                            </SectionSubsection>

                            <SectionSubsection
                                title={t('config_management.visual.sections.payload.override_raw_rules')}
                                description={t('config_management.visual.sections.payload.override_raw_rules_desc')}
                            >
                                <PayloadRulesEditor
                                    value={values.payloadOverrideRawRules}
                                    disabled={disabled}
                                    protocolFirst
                                    rawJsonValues
                                    onChange={handlePayloadOverrideRawRulesChange}
                                />
                            </SectionSubsection>

                            <SectionSubsection
                                title={t('config_management.visual.sections.payload.filter_rules')}
                                description={t('config_management.visual.sections.payload.filter_rules_desc')}
                            >
                                <PayloadFilterRulesEditor
                                    value={values.payloadFilterRules}
                                    disabled={disabled}
                                    onChange={handlePayloadFilterRulesChange}
                                />
                            </SectionSubsection>
                        </SectionStack>
                    </ConfigSection>
                </div>
            </div>
        </div>
    )
}
