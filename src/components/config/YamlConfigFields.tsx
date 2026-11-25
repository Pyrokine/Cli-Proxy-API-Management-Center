import {Button} from '@/components/ui/Button'
import {Collapsible} from '@/components/ui/Collapsible'
import {Input} from '@/components/ui/Input'
import {readVisualYamlFieldCatalog} from '@/hooks/visualConfigCodec'
import {canEditYamlConfigField, listYamlConfigFields, type YamlConfigField} from '@/hooks/visualConfigFields'
import type {
    YamlConfigFieldEdits,
    YamlConfigFieldState,
    YamlConfigFieldStates,
    YamlConfigFieldValue,
} from '@/types/visualConfig'
import {type ReactNode, useId, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {Link} from 'react-router'
import {
    configFieldDomId,
    type ConfigFieldSearchEntry,
    getYamlConfigFieldEntry,
    matchesYamlConfigField,
} from './configSearchIndex'
import styles from './VisualConfigEditor.module.scss'
import {StringListEditor} from './VisualConfigEditorBlocks'

const prefix       = 'config_management.yaml_fields.'
const sourceLabels = {
    yaml: 'In the YAML file',
    inherited: 'From a YAML alias or merge',
    default: 'Default',
    unset: 'Not set',
    unsupported: 'Unsupported YAML value',
    legacy: 'From a compatibility key',
    redacted: 'Value hidden by the server',
    fallback: 'Inherited setting',
} as const
const ownerLabels  = {
    home: 'Managed by Home',
    managed: 'Managed on a dedicated page',
    legacy: 'Compatibility field',
    ignored: 'Ignored by CPA',
    runtime: 'Runtime setting, not stored in YAML',
    catalog: 'Current setting in models.json',
} as const

const displayValue = (value: YamlConfigFieldValue) => typeof value === 'string' ? value || '""' : JSON.stringify(value)

export function YamlConfigFieldMeta({ field, state, pending = false, compact = false }: {
    field?: YamlConfigField
    state?: YamlConfigFieldState
    pending?: boolean
    compact?: boolean
}) {
    const { t }        = useTranslation()
    const source       = state?.source ?? (field?.defaultValue === undefined ? 'unset' : 'default')
    const value        = state?.value ?? (source === 'default' ? field?.defaultValue : undefined)
    const status       = source === 'legacy' ?
                         field?.id === 'remote-management.auto-update-panel' ?
                         t(
                             prefix + 'legacy_panel',
                             { defaultValue: 'From disable-auto-update-panel' },
                         ) :
                         t(prefix + 'compatibility_source') :
                         field?.owner === 'catalog' ? t(prefix + 'legacy_file') :
                         t(prefix + source, { defaultValue: sourceLabels[source] })
    const display      = value !== undefined ? displayValue(value) : state?.size !== undefined ?
                                                                     t(prefix + 'item_count', { total: state.size }) :
                                                                     source === 'yaml' || source === 'inherited' ?
                                                                     t(
                                                                         prefix + 'configured',
                                                                         { defaultValue: 'Configured (value hidden)' },
                                                                     ) : undefined
    const defaultNote  = field?.defaultNote && t(prefix + field.defaultNote)
    const defaultValue = field?.defaultValue === undefined ? undefined : displayValue(field.defaultValue)
    if (field?.owner === 'runtime' || (field?.owner === 'catalog' &&
                                       !field.template && (source === 'unset' || source === 'default'))) {
        return <span className={styles.fieldHint}>{t(
            prefix + field.owner,
            { defaultValue: ownerLabels[field.owner] },
        )}</span>
    }
    return (
        <span className={styles.fieldHint}>
            {field?.owner && field.owner !== 'managed' ?
             <>{t(prefix + field.owner, { defaultValue: ownerLabels[field.owner] })} · </> :
             field?.editable && !canEditYamlConfigField(field, state) ?
             <>{t(prefix + 'read_only', { defaultValue: 'Read-only in the form' })} · </> : null}
            {pending ? t(prefix + 'draft', { defaultValue: 'Unsaved change' }) :
             field?.template ? t(prefix + 'per_entry') : status}
            {!pending && !field?.template && display !== undefined && <>: <code>{display}</code></>}
            {!pending && state?.from && <> · <code>{state.from}</code></>}
            {!pending && state?.effective !== undefined &&
             <> · {t(prefix + 'effective_value_hint', { value: displayValue(state.effective) })}</>}
            {!compact && (field?.template || source !== 'default') && defaultValue !== undefined &&
             <> · {t(prefix + 'default')}: <code>{defaultValue}</code></>}
            {!compact && (defaultNote || (field?.template && field.inherits)) &&
             <> · {defaultNote ?? t(prefix + 'fallback')} {field?.template && field.inherits &&
                                                           <code>{field.inherits}</code>}</>}
        </span>
    )
}

function YamlConfigFieldAction({ field, entry, onSelect, disabled }: {
    field: YamlConfigField
    entry: ConfigFieldSearchEntry
    onSelect?: (entry: ConfigFieldSearchEntry) => void
    disabled?: boolean
}) {
    const { t }       = useTranslation()
    const destination = entry.destination ?? (entry.path && `${entry.path}?field=${encodeURIComponent(entry.fieldId)}`)
    const label       = entry.sourceField ? t(prefix + 'open_source') : destination ? t(prefix + 'open_owner') :
                                                                        t(prefix + 'open_field')
    const ariaLabel   = `${label}: ${field.id}`
    const action      = destination && !disabled ?
                        <Link to={destination} aria-label={ariaLabel}>{label}</Link> :
                        onSelect ?
                        <Button type='button' variant='secondary' size='sm' disabled={disabled}
                                aria-label={ariaLabel} onClick={() => onSelect(entry)}>{label}</Button> : null
    return action && <div>{action}</div>
}

type YamlConfigFieldInputProps = {
                                     label: string
                                     hint?: ReactNode
                                     disabled?: boolean
                                 } & (
                                     | {
                                           kind: 'list';
                                           value: string[];
                                           placeholder?: string;
                                           onChange: (value: string[]) => void
                                       }
                                     | {
                                           kind: 'boolean';
                                           value: boolean | null;
                                           onChange: (value: boolean | null) => void
                                       }
                                     | {
                                           kind: 'string' | 'integer'
                                           value: string
                                           placeholder?: string
                                           error?: string
                                           onChange: (value: string) => void
                                       }
                                     )

export function YamlConfigFieldInput(props: YamlConfigFieldInputProps) {
    const { t } = useTranslation()
    const id    = useId()
    if (props.kind === 'list') {
        return (
            <div className={styles.fieldShell} role='group' aria-label={props.label} aria-describedby={`${id}-hint`}>
                <StringListEditor value={props.value} disabled={props.disabled} placeholder={props.placeholder}
                                  inputAriaLabel={props.label} onChange={props.onChange} />
                <div id={`${id}-hint`} className={styles.fieldHint}>{props.hint}</div>
            </div>
        )
    }
    if (props.kind === 'boolean') {
        return (
            <div className={styles.fieldShell}>
                <label htmlFor={id} className={styles.fieldLabel}>{props.label}</label>
                <select id={id} className='input' value={props.value === null ? '' : String(props.value)}
                        aria-describedby={`${id}-hint`} disabled={props.disabled}
                        onChange={(event) => props.onChange(event.target.value ? event.target.value === 'true' : null)}>
                    <option value=''>{t(prefix + 'default', { defaultValue: 'Default' })}</option>
                    <option value='true'>true</option>
                    <option value='false'>false</option>
                </select>
                <div id={`${id}-hint`}>{props.hint}</div>
            </div>
        )
    }
    return <Input label={props.label} type={props.kind === 'integer' ? 'number' : 'text'} value={props.value}
                  disabled={props.disabled} placeholder={props.placeholder} hint={props.hint} error={props.error}
                  onChange={(event) => props.onChange(event.target.value)} />
}

export function YamlConfigFieldRows({
                                        fields,
                                        states,
                                        edits,
                                        disabled,
                                        onChange,
                                        anchored,
                                        onSelect,
                                        pluginsAvailable,
                                    }: {
    fields: YamlConfigField[]
    states: YamlConfigFieldStates
    edits?: YamlConfigFieldEdits
    disabled?: boolean
    onChange?: (edits: YamlConfigFieldEdits) => void
    anchored?: boolean
    onSelect?: (entry: ConfigFieldSearchEntry) => void
    pluginsAvailable?: boolean
}) {
    return (
        <div className={styles.sectionGrid}>
            {fields.map((field) => {
                const state    = states[field.id]
                const draft    = edits?.[field.id]
                const meta     = <YamlConfigFieldMeta field={field} state={state} pending={draft !== undefined} />
                const apply    = (value: boolean | string | null) => {
                    const next    = { ...edits }
                    const initial = state?.source === 'yaml' ? state.value : field.kind === 'boolean' ? null : ''
                    if (value === initial) {
                        delete next[field.id]
                    } else {
                        next[field.id] = value
                    }
                    onChange?.(next)
                }
                const editable = onChange && canEditYamlConfigField(field, state)
                const entry    = !anchored || (onSelect && field.editable && !editable) ?
                                 getYamlConfigFieldEntry(field, state, pluginsAvailable) : undefined
                const content  = editable && field.kind === 'boolean' ? (
                    <YamlConfigFieldInput kind='boolean' label={field.id} disabled={disabled} hint={meta}
                                          value={draft === null || typeof draft === 'boolean' ? draft :
                                                 state?.source === 'yaml' && typeof state.value === 'boolean' ?
                                                 state.value : null}
                                          onChange={apply} />
                ) : editable && field.kind === 'string' ? (
                    <YamlConfigFieldInput kind='string' label={field.id} disabled={disabled} hint={meta}
                                          placeholder={typeof field.defaultValue === 'string' ?
                                                       field.defaultValue :
                                                       undefined}
                                          value={typeof draft === 'string' ? draft :
                                                 state?.source === 'yaml' && typeof state.value === 'string' ?
                                                 state.value :
                                                 ''}
                                          onChange={apply} />
                ) : (
                        <div className={styles.fieldShell}>
                            <code className={styles.fieldLabel}>{field.id}</code>
                            {meta}
                            {entry && <YamlConfigFieldAction field={field} entry={entry}
                                                             onSelect={onSelect} disabled={disabled} />}
                        </div>
                    )
                return (
                    <div key={field.id} id={anchored ? configFieldDomId(field.id) : undefined}
                         className={styles.fieldAnchor} tabIndex={anchored && !editable ? -1 : undefined}
                         style={{ overflowWrap: 'anywhere' }}>
                        {content}
                    </div>
                )
            })}
        </div>
    )
}

const PAGE_SIZE = 48

export function ConfigYamlFieldCatalog({ yaml, snapshot, onSelect, disabled, pluginsAvailable }:
                                           ({ yaml: string; snapshot?: never } | {
                                               snapshot: YamlConfigFieldStates;
                                               yaml?: never
                                           }) & {
                                               onSelect?: (entry: ConfigFieldSearchEntry) => void
                                               disabled?: boolean
                                               pluginsAvailable?: boolean
                                           }) {
    const { t }             = useTranslation()
    const [open, setOpen]   = useState(false)
    const [query, setQuery] = useState('')
    const [limit, setLimit] = useState(PAGE_SIZE)
    const states            = useMemo(() => {
        if (open && yaml !== undefined) {
            try {
                return readVisualYamlFieldCatalog(yaml)
            } catch {
                return null
            }
        }
        return snapshot
    }, [open, snapshot, yaml])
    const q                 = query.trim().toLowerCase()
    const fields            = open ? listYamlConfigFields(states ?? {}).filter((field) =>
                                                                                   q ?
                                                                                   matchesYamlConfigField(field.id, q) :
                                                                                   field.path.length === 1) : []
    const rank              = (field: YamlConfigField) => field.id.toLowerCase() === q ? 0 : field.template ? 2 : 1
    if (q) {
        fields.sort((left, right) => rank(left) - rank(right))
    }
    return (
        <Collapsible label={t(prefix + 'title', { defaultValue: 'YAML fields and defaults' })}
                     hint={t(prefix + 'description', { defaultValue: 'View settings, defaults and ownership.' })}
                     open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
            {open && <div className={styles.sectionStack}>
                <Input type='search' value={query} onChange={(event) => {
                    setQuery(event.target.value)
                    setLimit(PAGE_SIZE)
                }} label={t(prefix + 'search', { defaultValue: 'Find a YAML path' })}
                       hint={t(prefix + 'search_hint')} />
                {states === null ? <p role='status'>{t(prefix + 'invalid', {
                    defaultValue: 'This YAML cannot be read yet.',
                })}</p> : fields.length ? <YamlConfigFieldRows fields={fields.slice(0, limit)} states={states ?? {}}
                                                               onSelect={onSelect} disabled={disabled}
                                                               pluginsAvailable={pluginsAvailable} /> :
                          <p role='status'>{t(prefix + 'empty', { defaultValue: 'No matching fields.' })}</p>}
                {states !== null && fields.length > limit && <div>
                    <Button type='button' size='sm' variant='secondary' onClick={() => setLimit(limit + PAGE_SIZE)}>
                        {t(prefix + 'show_more', { count: fields.length - limit })}
                    </Button>
                </div>}
            </div>}
        </Collapsible>
    )
}
