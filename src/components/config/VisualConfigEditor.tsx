import { ConfigSection } from '@/components/config/ConfigSection'
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
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { ToggleSwitch } from '@/components/ui/ToggleSwitch'
import type {
    PayloadFilterRule,
    PayloadParamValidationErrorCode,
    PayloadRule,
    VisualConfigFieldPath,
    VisualConfigValidationErrorCode,
    VisualConfigValidationErrors,
    VisualConfigValues,
} from '@/types/visualConfig'
import { type ComponentType, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './VisualConfigEditor.module.scss'
import { ApiKeysCardEditor, PayloadFilterRulesEditor, PayloadRulesEditor } from './VisualConfigEditorBlocks'

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
    onChange: (values: Partial<VisualConfigValues>) => void
}

function getValidationMessage(
    t: ReturnType<typeof useTranslation>['t'],
    errorCode?: VisualConfigValidationErrorCode | PayloadParamValidationErrorCode
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
    onChange: (value: boolean) => void
}

function ToggleRow({ title, description, checked, disabled, onChange }: ToggleRowProps) {
    return (
        <div className={styles.toggleRow}>
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
    children,
}: {
    label: string
    labelId?: string
    htmlFor?: string
    hint?: string
    hintId?: string
    error?: string
    errorId?: string
    children: ReactNode
}) {
    return (
        <div className={styles.fieldShell}>
            <label id={labelId} htmlFor={htmlFor} className={styles.fieldLabel}>
                {label}
            </label>
            {children}
            {error ? (
                <div id={errorId} className="error-box">
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

export function VisualConfigEditor({
    values,
    validationErrors,
    hasPayloadValidationErrors = false,
    disabled = false,
    onChange,
}: VisualConfigEditorProps) {
    const { t } = useTranslation()
    const routingStrategyLabelId = useId()
    const routingStrategyHintId = `${routingStrategyLabelId}-hint`
    const keepaliveInputId = useId()
    const keepaliveHintId = `${keepaliveInputId}-hint`
    const keepaliveErrorId = `${keepaliveInputId}-error`
    const nonstreamKeepaliveInputId = useId()
    const nonstreamKeepaliveHintId = `${nonstreamKeepaliveInputId}-hint`
    const nonstreamKeepaliveErrorId = `${nonstreamKeepaliveInputId}-error`
    const [activeSectionId, setActiveSectionId] = useState<VisualSectionId>('server')
    const workspaceRef = useRef<HTMLDivElement | null>(null)
    const sectionRefs = useRef<Partial<Record<VisualSectionId, HTMLElement | null>>>({})

    const isKeepaliveDisabled = values.streaming.keepaliveSeconds === '' || values.streaming.keepaliveSeconds === '0'
    const isNonstreamKeepaliveDisabled =
        values.streaming.nonstreamKeepaliveInterval === '' || values.streaming.nonstreamKeepaliveInterval === '0'

    const portError = getValidationMessage(t, validationErrors?.port)
    const logsMaxSizeError = getValidationMessage(t, validationErrors?.logsMaxTotalSizeMb)
    const requestRetryError = getValidationMessage(t, validationErrors?.requestRetry)
    const maxRetryCredentialsError = getValidationMessage(t, validationErrors?.maxRetryCredentials)
    const maxRetryIntervalError = getValidationMessage(t, validationErrors?.maxRetryInterval)
    const keepaliveError = getValidationMessage(t, validationErrors?.['streaming.keepaliveSeconds'])
    const bootstrapRetriesError = getValidationMessage(t, validationErrors?.['streaming.bootstrapRetries'])
    const nonstreamKeepaliveError = getValidationMessage(t, validationErrors?.['streaming.nonstreamKeepaliveInterval'])

    const handleApiKeysTextChange = useCallback((apiKeysText: string) => onChange({ apiKeysText }), [onChange])
    const handlePayloadDefaultRulesChange = useCallback(
        (payloadDefaultRules: PayloadRule[]) => onChange({ payloadDefaultRules }),
        [onChange]
    )
    const handlePayloadDefaultRawRulesChange = useCallback(
        (payloadDefaultRawRules: PayloadRule[]) => onChange({ payloadDefaultRawRules }),
        [onChange]
    )
    const handlePayloadOverrideRulesChange = useCallback(
        (payloadOverrideRules: PayloadRule[]) => onChange({ payloadOverrideRules }),
        [onChange]
    )
    const handlePayloadOverrideRawRulesChange = useCallback(
        (payloadOverrideRawRules: PayloadRule[]) => onChange({ payloadOverrideRawRules }),
        [onChange]
    )
    const handlePayloadFilterRulesChange = useCallback(
        (payloadFilterRules: PayloadFilterRule[]) => onChange({ payloadFilterRules }),
        [onChange]
    )

    const countErrors = useCallback(
        (fields: VisualConfigFieldPath[]) =>
            fields.reduce((total, field) => total + (validationErrors?.[field] ? 1 : 0), 0),
        [validationErrors]
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
                errorCount: countErrors(['logsMaxTotalSizeMb']),
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
                errorCount: 0,
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
        [countErrors, hasPayloadValidationErrors, t]
    )

    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') {
            return undefined
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const visibleEntries = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((left, right) => right.intersectionRatio - left.intersectionRatio)

                if (visibleEntries.length === 0) {
                    return
                }
                setActiveSectionId(visibleEntries[0].target.id as VisualSectionId)
            },
            {
                rootMargin: '-10% 0px -30% 0px',
                threshold: [0.05, 0.15, 0.3, 0.55],
            }
        )

        for (const section of sections) {
            const element = sectionRefs.current[section.id]
            if (element) {
                observer.observe(element)
            }
        }

        return () => observer.disconnect()
    }, [sections])

    const handleSectionJump = useCallback((sectionId: VisualSectionId) => {
        setActiveSectionId(sectionId)
        sectionRefs.current[sectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, [])

    const navContent = (
        <div className={styles.navList}>
            {sections.map((section, index) => {
                const Icon = section.icon

                return (
                    <button
                        key={section.id}
                        type="button"
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
                                    <span className={styles.navBadge} aria-hidden="true">
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
                        id="server"
                        ref={(node) => {
                            sectionRefs.current.server = node
                        }}
                        indexLabel="01"
                        icon={<IconSettings size={16} />}
                        title={t('config_management.visual.sections.server.title')}
                        description={t('config_management.visual.sections.server.description')}
                    >
                        <SectionGrid>
                            <Input
                                label={t('config_management.visual.sections.server.host')}
                                placeholder="127.0.0.1"
                                value={values.host}
                                onChange={(e) => onChange({ host: e.target.value })}
                                disabled={disabled}
                                hint={t('config_management.visual.sections.server.host_hint')}
                            />
                            <Input
                                label={t('config_management.visual.sections.server.port')}
                                type="number"
                                placeholder="8317"
                                value={values.port}
                                onChange={(e) => onChange({ port: e.target.value })}
                                disabled={disabled}
                                error={portError}
                            />
                        </SectionGrid>
                    </ConfigSection>

                    <ConfigSection
                        id="tls"
                        ref={(node) => {
                            sectionRefs.current.tls = node
                        }}
                        indexLabel="02"
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

                            {values.tlsEnable ? (
                                <>
                                    <Divider />
                                    <SectionGrid>
                                        <Input
                                            label={t('config_management.visual.sections.tls.cert')}
                                            placeholder="/path/to/cert.pem"
                                            value={values.tlsCert}
                                            onChange={(e) => onChange({ tlsCert: e.target.value })}
                                            disabled={disabled}
                                        />
                                        <Input
                                            label={t('config_management.visual.sections.tls.key')}
                                            placeholder="/path/to/key.pem"
                                            value={values.tlsKey}
                                            onChange={(e) => onChange({ tlsKey: e.target.value })}
                                            disabled={disabled}
                                        />
                                    </SectionGrid>
                                    <ToggleRow
                                        title={t('config_management.visual.sections.tls.trust_forwarded_proto')}
                                        description={t(
                                            'config_management.visual.sections.tls.trust_forwarded_proto_desc'
                                        )}
                                        checked={values.tlsTrustForwardedProto}
                                        disabled={disabled}
                                        onChange={(tlsTrustForwardedProto) => onChange({ tlsTrustForwardedProto })}
                                    />
                                </>
                            ) : null}
                        </SectionStack>
                    </ConfigSection>

                    <ConfigSection
                        id="remote"
                        ref={(node) => {
                            sectionRefs.current.remote = node
                        }}
                        indexLabel="03"
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
                                    type="password"
                                    placeholder={t('config_management.visual.sections.remote.secret_key_placeholder')}
                                    value={values.rmSecretKey}
                                    onChange={(e) => onChange({ rmSecretKey: e.target.value })}
                                    disabled={disabled}
                                />
                                <Input
                                    label={t('config_management.visual.sections.remote.panel_repo')}
                                    placeholder="https://github.com/Pyrokine/Cli-Proxy-API-Management-Center"
                                    value={values.rmPanelRepo}
                                    onChange={(e) => onChange({ rmPanelRepo: e.target.value })}
                                    disabled={disabled}
                                />
                                <Input
                                    label={t('config_management.visual.sections.remote.cpa_repo', {
                                        defaultValue: 'CPA GitHub Repository',
                                    })}
                                    placeholder="https://github.com/Pyrokine/CLIProxyAPI"
                                    value={values.rmCpaRepo}
                                    onChange={(e) => onChange({ rmCpaRepo: e.target.value })}
                                    disabled={disabled}
                                />
                            </SectionGrid>
                        </SectionStack>
                    </ConfigSection>

                    <ConfigSection
                        id="auth"
                        ref={(node) => {
                            sectionRefs.current.auth = node
                        }}
                        indexLabel="04"
                        icon={<IconKey size={16} />}
                        title={t('config_management.visual.sections.auth.title')}
                        description={t('config_management.visual.sections.auth.description')}
                    >
                        <SectionStack>
                            <Input
                                label={t('config_management.visual.sections.auth.auth_dir')}
                                placeholder="~/.cli-proxy-api"
                                value={values.authDir}
                                onChange={(e) => onChange({ authDir: e.target.value })}
                                disabled={disabled}
                                hint={t('config_management.visual.sections.auth.auth_dir_hint')}
                            />
                            <div className={styles.subsection}>
                                <ApiKeysCardEditor
                                    value={values.apiKeysText}
                                    disabled={disabled}
                                    onChange={handleApiKeysTextChange}
                                />
                            </div>
                        </SectionStack>
                    </ConfigSection>

                    <ConfigSection
                        id="system"
                        ref={(node) => {
                            sectionRefs.current.system = node
                        }}
                        indexLabel="05"
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
                                    title={t('config_management.visual.sections.system.usage_statistics')}
                                    description={t('config_management.visual.sections.system.usage_statistics_desc')}
                                    checked={values.usageStatisticsEnabled}
                                    disabled={disabled}
                                    onChange={(usageStatisticsEnabled) => onChange({ usageStatisticsEnabled })}
                                />
                            </SectionGrid>

                            <SectionGrid>
                                <Input
                                    label={t('config_management.visual.sections.system.logs_max_size')}
                                    type="number"
                                    placeholder="0"
                                    value={values.logsMaxTotalSizeMb}
                                    onChange={(e) => onChange({ logsMaxTotalSizeMb: e.target.value })}
                                    disabled={disabled}
                                    error={logsMaxSizeError}
                                />
                                <Input
                                    label={t('config_management.visual.sections.system.usage_data_dir')}
                                    placeholder="~/.cli-proxy-api/usage"
                                    value={values.usageDataDir}
                                    onChange={(e) => onChange({ usageDataDir: e.target.value })}
                                    disabled={disabled}
                                    hint={t('config_management.visual.sections.system.usage_data_dir_hint')}
                                />
                            </SectionGrid>
                        </SectionStack>
                    </ConfigSection>

                    <ConfigSection
                        id="network"
                        ref={(node) => {
                            sectionRefs.current.network = node
                        }}
                        indexLabel="06"
                        icon={<IconTrendingUp size={16} />}
                        title={t('config_management.visual.sections.network.title')}
                        description={t('config_management.visual.sections.network.description')}
                    >
                        <SectionStack>
                            <SectionGrid>
                                <Input
                                    label={t('config_management.visual.sections.network.proxy_url')}
                                    placeholder="socks5://user:pass@127.0.0.1:1080/"
                                    value={values.proxyUrl}
                                    onChange={(e) => onChange({ proxyUrl: e.target.value })}
                                    disabled={disabled}
                                />
                                <Input
                                    label={t('config_management.visual.sections.network.request_retry')}
                                    type="number"
                                    placeholder="3"
                                    value={values.requestRetry}
                                    onChange={(e) => onChange({ requestRetry: e.target.value })}
                                    disabled={disabled}
                                    error={requestRetryError}
                                />
                                <Input
                                    label={t('config_management.visual.sections.network.max_retry_credentials')}
                                    type="number"
                                    placeholder="0"
                                    value={values.maxRetryCredentials}
                                    onChange={(e) => onChange({ maxRetryCredentials: e.target.value })}
                                    disabled={disabled}
                                    hint={t('config_management.visual.sections.network.max_retry_credentials_hint')}
                                    error={maxRetryCredentialsError}
                                />
                                <Input
                                    label={t('config_management.visual.sections.network.max_retry_interval')}
                                    type="number"
                                    placeholder="30"
                                    value={values.maxRetryInterval}
                                    onChange={(e) => onChange({ maxRetryInterval: e.target.value })}
                                    disabled={disabled}
                                    error={maxRetryIntervalError}
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
                                                    'config_management.visual.sections.network.strategy_round_robin'
                                                ),
                                            },
                                            {
                                                value: 'fill-first',
                                                label: t(
                                                    'config_management.visual.sections.network.strategy_fill_first'
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
                                <Input
                                    label={t('config_management.visual.sections.network.session_affinity_ttl')}
                                    placeholder="1h"
                                    value={values.routingSessionAffinityTTL}
                                    onChange={(e) => onChange({ routingSessionAffinityTTL: e.target.value })}
                                    disabled={disabled}
                                />
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
                                    title={t('config_management.visual.sections.network.session_affinity')}
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
                                    onChange={(allowQueryAuth) => onChange({ allowQueryAuth })}
                                />
                            </SectionGrid>
                        </SectionStack>
                    </ConfigSection>

                    <ConfigSection
                        id="quota"
                        ref={(node) => {
                            sectionRefs.current.quota = node
                        }}
                        indexLabel="07"
                        icon={<IconTimer size={16} />}
                        title={t('config_management.visual.sections.quota.title')}
                        description={t('config_management.visual.sections.quota.description')}
                    >
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
                        </SectionGrid>
                    </ConfigSection>

                    <ConfigSection
                        id="streaming"
                        ref={(node) => {
                            sectionRefs.current.streaming = node
                        }}
                        indexLabel="08"
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
                                            className="input"
                                            type="number"
                                            placeholder="0"
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
                                    type="number"
                                    placeholder="1"
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
                                            className="input"
                                            type="number"
                                            placeholder="0"
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
                        id="payload"
                        ref={(node) => {
                            sectionRefs.current.payload = node
                        }}
                        indexLabel="09"
                        icon={<IconCode size={16} />}
                        title={t('config_management.visual.sections.payload.title')}
                        description={t('config_management.visual.sections.payload.description')}
                    >
                        <SectionStack>
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
