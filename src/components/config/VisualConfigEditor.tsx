import {ConfigSection} from '@/components/config/ConfigSection'
import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {Modal} from '@/components/ui/Modal'
import {Pagination} from '@/components/ui/Pagination'
import {Select} from '@/components/ui/Select'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {useListFilter} from '@/hooks/useListFilter'
import {usePagination} from '@/hooks/usePagination'
import {VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS, VISUAL_CONFIG_PROTOCOL_OPTIONS} from '@/hooks/useVisualConfig'
import {apiKeyAliasApi} from '@/services/api/apiKeys'
import {useNotificationStore} from '@/stores'
import type {
    PayloadFilterRule,
    PayloadModelEntry,
    PayloadParamEntry,
    PayloadParamValueType,
    PayloadRule,
    VisualConfigValues,
} from '@/types/visualConfig'
import {makeClientId} from '@/types/visualConfig'
import {copyToClipboard} from '@/utils/clipboard'
import {formatKeyDisplay} from '@/utils/format'
import {isValidApiKey} from '@/utils/validation'
import {type ReactNode, useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './VisualConfigEditor.module.scss'

interface VisualConfigEditorProps {
    values: VisualConfigValues;
    disabled?: boolean;
    onChange: (values: Partial<VisualConfigValues>) => void;
}

type ToggleRowProps = {
    title: string;
    description?: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (value: boolean) => void;
};

function ToggleRow({ title, description, checked, disabled, onChange }: ToggleRowProps) {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
            }}
        >
            <div style={{ minWidth: 220 }}>
                <div className={styles.label}>{title}</div>
                {description && (
                    <div className={styles.desc} style={{ marginTop: 2 }}>
                        {description}
                    </div>
                )}
            </div>
            <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={title} />
        </div>
    )
}

function SectionGrid({ children }: { children: ReactNode }) {
    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: 12,
            }}
        >
            {children}
        </div>
    )
}

function Divider() {
    return <div style={{ height: 1, background: 'var(--border-color)', margin: '16px 0' }} />
}

function highlightMatch(text: string, query: string): ReactNode {
    if (!query) {
        return text
    }
    const idx = text.toLowerCase().indexOf(query.toLowerCase())
    if (idx === -1) {
        return text
    }
    return (
        <>
            {text.slice(0, idx)}
            <mark>{text.slice(idx, idx + query.length)}</mark>
            {text.slice(idx + query.length)}
        </>
    )
}

function ApiKeysCardEditor({
                               value,
                               disabled,
                               onChange,
                           }: {
    value: string;
    disabled?: boolean;
    onChange: (nextValue: string) => void;
}) {
    const { t }                = useTranslation()
    const { showNotification } = useNotificationStore()
    const apiKeys              = useMemo(
        () =>
            value
                .split('\n')
                .map((key) => key.trim())
                .filter(Boolean),
        [value],
    )

    const [modalOpen, setModalOpen]       = useState(false)
    const [editingIndex, setEditingIndex] = useState<number | null>(null)
    const [inputValue, setInputValue]     = useState('')
    const [formError, setFormError]       = useState('')
    const [aliasValue, setAliasValue]     = useState('')
    const [aliasError, setAliasError]     = useState('')
    const [aliases, setAliases]           = useState<Record<string, string>>({})

    // noinspection DuplicatedCode
    useEffect(() => {
        let cancelled = false
        void apiKeyAliasApi
            .list()
            .then((data) => {
                if (!cancelled) {
                    setAliases(data)
                }
            })
            .catch((err) => {
                console.warn('Failed to load API key aliases:', err)
            })
        return () => {
            cancelled = true
        }
    }, [])

    function validateAlias(alias: string): string | null {
        if (!alias) {
            return null
        }
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(alias)) {
            return t('config_management.visual.api_keys.alias_error_format')
        }
        if (alias.length > 20) {
            return t('config_management.visual.api_keys.alias_error_length')
        }
        return null
    }

    function generateSecureApiKey(alias?: string): string {
        const array = new Uint8Array(32)
        crypto.getRandomValues(array)
        const hex = Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
        return alias ? `sk-${alias}-${hex}` : `sk-${hex}`
    }

    const openAddModal = () => {
        setEditingIndex(null)
        setInputValue('')
        setFormError('')
        setAliasValue('')
        setAliasError('')
        setModalOpen(true)
    }

    const openEditModal = (index: number) => {
        setEditingIndex(index)
        setInputValue(apiKeys[index] ?? '')
        setAliasValue(aliases[apiKeys[index]] ?? '')
        setAliasError('')
        setFormError('')
        setModalOpen(true)
    }

    const closeModal = () => {
        setModalOpen(false)
        setInputValue('')
        setEditingIndex(null)
        setFormError('')
        setAliasValue('')
        setAliasError('')
    }

    const updateApiKeys = (nextKeys: string[]) => {
        onChange(nextKeys.join('\n'))
    }

    const handleDelete = (index: number) => {
        const deletedKey = apiKeys[index]
        updateApiKeys(apiKeys.filter((_, i) => i !== index))
        if (aliases[deletedKey]) {
            void apiKeyAliasApi.remove(deletedKey).catch(() => {
            })
            setAliases((prev) => {
                const next = { ...prev }
                delete next[deletedKey]
                return next
            })
        }
    }

    const handleSave = async () => {
        const trimmed = inputValue.trim()
        if (!trimmed) {
            setFormError(t('config_management.visual.api_keys.error_empty'))
            return
        }
        if (!isValidApiKey(trimmed)) {
            setFormError(
                trimmed.length < 8
                ? t('config_management.visual.api_keys.error_too_short')
                : t('config_management.visual.api_keys.error_invalid'),
            )
            return
        }

        const trimmedAlias = aliasValue.trim()
        const aliasErr     = validateAlias(trimmedAlias)
        if (aliasErr) {
            setAliasError(aliasErr)
            return
        }

        // 别名冲突检测
        if (trimmedAlias) {
            const currentKey = editingIndex !== null ? apiKeys[editingIndex] : ''
            const conflict   = Object.entries(aliases).find(([k, v]) => v === trimmedAlias && k !== currentKey)
            if (conflict) {
                setAliasError(t('config_management.visual.api_keys.alias_error_duplicate'))
                return
            }
        }

        const oldKey   = editingIndex !== null ? apiKeys[editingIndex] : null
        const nextKeys =
                  editingIndex === null ?
                      [...apiKeys, trimmed] :
                  apiKeys.map((key, idx) => (idx === editingIndex ? trimmed : key))
        updateApiKeys(nextKeys)

        // 别名处理
        try {
            if (oldKey && oldKey !== trimmed && aliases[oldKey]) {
                await apiKeyAliasApi.remove(oldKey)
            }
            if (trimmedAlias) {
                await apiKeyAliasApi.set(trimmed, trimmedAlias)
                setAliases((prev) => {
                    const next = { ...prev }
                    if (oldKey && oldKey !== trimmed) {
                        delete next[oldKey]
                    }
                    next[trimmed] = trimmedAlias
                    return next
                })
            } else if (oldKey && aliases[oldKey]) {
                const keyToRemove = oldKey !== trimmed ? oldKey : trimmed
                await apiKeyAliasApi.remove(keyToRemove)
                setAliases((prev) => {
                    const next = { ...prev }
                    delete next[oldKey]
                    if (oldKey !== trimmed) {
                        delete next[trimmed]
                    }
                    return next
                })
            }
        } catch {
            /* 别名操作失败不阻塞 key 保存 */
        }

        closeModal()
    }

    const handleCopy = async (apiKey: string) => {
        const copied = await copyToClipboard(apiKey)
        showNotification(
            t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
            copied ? 'success' : 'error',
        )
    }

    const handleGenerate = () => {
        const trimmedAlias = aliasValue.trim()
        const error        = validateAlias(trimmedAlias)
        if (error) {
            setAliasError(error)
            return
        }
        setInputValue(generateSecureApiKey(trimmedAlias || undefined))
        setFormError('')
    }

    const keySearchPredicate = useCallback(
        (key: string, q: string) => {
            const alias = aliases[key]
            return key.toLowerCase().includes(q) || (alias?.toLowerCase().includes(q) ?? false)
        },
        [aliases],
    )
    const {
              query: searchQuery,
              setQuery: setSearchQuery,
              filtered: filteredKeys,
              showSearch,
          }                  = useListFilter(apiKeys, keySearchPredicate)

    const indexedFilteredKeys = useMemo(
        () => filteredKeys.map((key) => ({ key, originalIndex: apiKeys.indexOf(key) })),
        [filteredKeys, apiKeys],
    )

    const {
              currentItems: pagedKeys,
              currentPage,
              pageSize,
              totalPages,
              goToPage,
              setPageSize,
          } = usePagination(indexedFilteredKeys, 20)

    return (
        <div className='form-group' style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <label style={{ margin: 0 }}>{t('config_management.visual.api_keys.label')}</label>
                <Button size='sm' onClick={openAddModal} disabled={disabled}>
                    {t('config_management.visual.api_keys.add')}
                </Button>
            </div>

            {showSearch && (
                <Input
                    placeholder={t('config_management.visual.api_keys.search_placeholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ marginTop: 4 }}
                />
            )}

            {apiKeys.length === 0 ? (
                <div className={styles.emptyState}>{t('config_management.visual.api_keys.empty')}</div>
            ) : (
                 <>
                     <div className='item-list' style={{ marginTop: 4 }}>
                         {pagedKeys.map(({ key, originalIndex }) => (
                             <div key={`${key}-${originalIndex}`} className='item-row'>
                                 <div className='item-meta'>
                                     <div className='pill'>#{originalIndex + 1}</div>
                                     <div className='item-title'>API Key</div>
                                     <div className='item-subtitle'>
                                         {highlightMatch(formatKeyDisplay(String(key || ''), aliases), searchQuery)}
                                     </div>
                                 </div>
                                 <div className='item-actions'>
                                     <Button variant='secondary' size='sm' onClick={() => handleCopy(key)}
                                             disabled={disabled}>
                                         {t('common.copy')}
                                     </Button>
                                     <Button
                                         variant='secondary'
                                         size='sm'
                                         onClick={() => openEditModal(originalIndex)}
                                         disabled={disabled}
                                     >
                                         {t('config_management.visual.common.edit')}
                                     </Button>
                                     <Button variant='danger' size='sm' onClick={() => handleDelete(originalIndex)}
                                             disabled={disabled}>
                                         {t('config_management.visual.common.delete')}
                                     </Button>
                                 </div>
                             </div>
                         ))}
                     </div>
                     {totalPages > 1 && (
                         <Pagination
                             total={indexedFilteredKeys.length}
                             page={currentPage}
                             pageSize={pageSize}
                             onPageChange={goToPage}
                             onPageSizeChange={setPageSize}
                         />
                     )}
                 </>
             )}

            <div className='hint'>{t('config_management.visual.api_keys.hint')}</div>

            <Modal
                open={modalOpen}
                onClose={closeModal}
                title={
                    editingIndex !== null
                    ? t('config_management.visual.api_keys.edit_title')
                    : t('config_management.visual.api_keys.add_title')
                }
                footer={
                    <>
                        <Button variant='secondary' onClick={closeModal} disabled={disabled}>
                            {t('config_management.visual.common.cancel')}
                        </Button>
                        <Button onClick={() => void handleSave()} disabled={disabled}>
                            {editingIndex !== null
                             ? t('config_management.visual.common.update')
                             : t('config_management.visual.common.add')}
                        </Button>
                    </>
                }
            >
                <Input
                    label={t('config_management.visual.api_keys.alias_label')}
                    placeholder={t('config_management.visual.api_keys.alias_placeholder')}
                    value={aliasValue}
                    onChange={(e) => {
                        setAliasValue(e.target.value)
                        setAliasError('')
                    }}
                    disabled={disabled}
                    error={aliasError || undefined}
                    hint={t('config_management.visual.api_keys.alias_hint')}
                />
                <Input
                    placeholder={t('config_management.visual.api_keys.input_placeholder')}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    disabled={disabled}
                    error={formError || undefined}
                    hint={t('config_management.visual.api_keys.input_hint')}
                    style={{ paddingRight: 148 }}
                    rightElement={
                        <Button type='button' variant='secondary' size='sm' onClick={handleGenerate}
                                disabled={disabled}>
                            {t('config_management.visual.api_keys.generate')}
                        </Button>
                    }
                />
            </Modal>
        </div>
    )
}

function StringListEditor({
                              value,
                              disabled,
                              placeholder,
                              onChange,
                          }: {
    value: string[];
    disabled?: boolean;
    placeholder?: string;
    onChange: (next: string[]) => void;
}) {
    const { t } = useTranslation()
    const items = value.length ? value : []

    const updateItem = (index: number, nextValue: string) =>
        onChange(items.map((item, i) => (i === index ? nextValue : item)))
    const addItem    = () => onChange([...items, ''])
    const removeItem = (index: number) => onChange(items.filter((_, i) => i !== index))

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((item, index) => (
                <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                        className='input'
                        placeholder={placeholder}
                        value={item}
                        onChange={(e) => updateItem(index, e.target.value)}
                        disabled={disabled}
                        style={{ flex: 1 }}
                    />
                    <Button variant='ghost' size='sm' onClick={() => removeItem(index)} disabled={disabled}>
                        {t('config_management.visual.common.delete')}
                    </Button>
                </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant='secondary' size='sm' onClick={addItem} disabled={disabled}>
                    {t('config_management.visual.common.add')}
                </Button>
            </div>
        </div>
    )
}

// 泛型 CRUD 辅助：PayloadRulesEditor 和 PayloadFilterRulesEditor 共享 rule/model 操作
type PayloadRuleBase = { id: string; models: PayloadModelEntry[] };

function buildRuleCrud<T extends PayloadRuleBase>(rules: T[], onChange: (next: T[]) => void) {
    const updateRule = (ruleIndex: number, patch: Partial<T>) =>
        onChange(rules.map((rule, i) => (i === ruleIndex ? { ...rule, ...patch } : rule)))

    return {
        addRule: () => onChange([...rules, { id: makeClientId(), models: [], params: [] } as unknown as T]),
        removeRule: (ruleIndex: number) => onChange(rules.filter((_, i) => i !== ruleIndex)),
        updateRule,
        addModel: (ruleIndex: number) => {
            const nextModel: PayloadModelEntry = { id: makeClientId(), name: '', protocol: undefined }
            updateRule(ruleIndex, { models: [...rules[ruleIndex].models, nextModel] } as Partial<T>)
        },
        removeModel: (ruleIndex: number, modelIndex: number) =>
            updateRule(ruleIndex, {
                models: rules[ruleIndex].models.filter((_, i) => i !== modelIndex),
            } as Partial<T>),
        updateModel: (ruleIndex: number, modelIndex: number, patch: Partial<PayloadModelEntry>) =>
            updateRule(ruleIndex, {
                models: rules[ruleIndex].models.map((m, i) => (i === modelIndex ? { ...m, ...patch } : m)),
            } as Partial<T>),
    }
}

function PayloadRulesEditor({
                                value,
                                disabled,
                                protocolFirst = false,
                                onChange,
                            }: {
    value: PayloadRule[];
    disabled?: boolean;
    protocolFirst?: boolean;
    onChange: (next: PayloadRule[]) => void;
}) {
    const { t }                   = useTranslation()
    const rules                   = value.length ? value : []
    const protocolOptions         = useMemo(
        () =>
            VISUAL_CONFIG_PROTOCOL_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey, { defaultValue: option.defaultLabel }),
            })),
        [t],
    )
    const payloadValueTypeOptions = useMemo(
        () =>
            VISUAL_CONFIG_PAYLOAD_VALUE_TYPE_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey, { defaultValue: option.defaultLabel }),
            })),
        [t],
    )

    const { addRule, removeRule, updateRule, addModel, removeModel, updateModel } = buildRuleCrud(rules, onChange)

    const addParam = (ruleIndex: number) => {
        const rule                         = rules[ruleIndex]
        const nextParam: PayloadParamEntry = {
            id: makeClientId(),
            path: '',
            valueType: 'string',
            value: '',
        }
        updateRule(ruleIndex, { params: [...rule.params, nextParam] })
    }

    const removeParam = (ruleIndex: number, paramIndex: number) => {
        const rule = rules[ruleIndex]
        updateRule(ruleIndex, { params: rule.params.filter((_, i) => i !== paramIndex) })
    }

    const updateParam = (ruleIndex: number, paramIndex: number, patch: Partial<PayloadParamEntry>) => {
        const rule = rules[ruleIndex]
        updateRule(ruleIndex, {
            params: rule.params.map((p, i) => (i === paramIndex ? { ...p, ...patch } : p)),
        })
    }

    const getValuePlaceholder = (valueType: PayloadParamValueType) => {
        switch (valueType) {
            case 'string':
                return t('config_management.visual.payload_rules.value_string')
            case 'number':
                return t('config_management.visual.payload_rules.value_number')
            case 'boolean':
                return t('config_management.visual.payload_rules.value_boolean')
            case 'json':
                return t('config_management.visual.payload_rules.value_json')
            default:
                return t('config_management.visual.payload_rules.value_default')
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rules.map((rule, ruleIndex) => (
                <div
                    key={rule.id}
                    style={{
                        border: '1px solid var(--border-color)',
                        borderRadius: 12,
                        padding: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 12,
                            flexWrap: 'wrap',
                        }}
                    >
                        <div className={styles.label}>
                            {t('config_management.visual.payload_rules.rule')} {ruleIndex + 1}
                        </div>
                        <Button variant='ghost' size='sm' onClick={() => removeRule(ruleIndex)} disabled={disabled}>
                            {t('config_management.visual.common.delete')}
                        </Button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div className={styles.fieldLabel}>{t('config_management.visual.payload_rules.models')}</div>
                        {(rule.models.length ? rule.models : []).map((model, modelIndex) => (
                            <div
                                key={model.id}
                                className={[
                                    styles.payloadRuleModelRow,
                                    protocolFirst ? styles.payloadRuleModelRowProtocolFirst : '',
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                            >
                                {protocolFirst ? (
                                    <>
                                        <Select
                                            value={model.protocol ?? ''}
                                            options={protocolOptions}
                                            disabled={disabled}
                                            ariaLabel={t('config_management.visual.payload_rules.provider_type')}
                                            onChange={(nextValue) =>
                                                updateModel(ruleIndex, modelIndex, {
                                                    protocol: (nextValue || undefined) as PayloadModelEntry['protocol'],
                                                })
                                            }
                                        />
                                        <input
                                            className='input'
                                            placeholder={t('config_management.visual.payload_rules.model_name')}
                                            value={model.name}
                                            onChange={(e) => updateModel(
                                                ruleIndex,
                                                modelIndex,
                                                { name: e.target.value },
                                            )}
                                            disabled={disabled}
                                        />
                                    </>
                                ) : (
                                     <>
                                         <input
                                             className='input'
                                             placeholder={t('config_management.visual.payload_rules.model_name')}
                                             value={model.name}
                                             onChange={(e) => updateModel(
                                                 ruleIndex,
                                                 modelIndex,
                                                 { name: e.target.value },
                                             )}
                                             disabled={disabled}
                                         />
                                         <Select
                                             value={model.protocol ?? ''}
                                             options={protocolOptions}
                                             disabled={disabled}
                                             ariaLabel={t('config_management.visual.payload_rules.provider_type')}
                                             onChange={(nextValue) =>
                                                 updateModel(ruleIndex, modelIndex, {
                                                     protocol: (nextValue ||
                                                                undefined) as PayloadModelEntry['protocol'],
                                                 })
                                             }
                                         />
                                     </>
                                 )}
                                <Button
                                    variant='ghost'
                                    size='sm'
                                    className={styles.payloadRowActionButton}
                                    onClick={() => removeModel(ruleIndex, modelIndex)}
                                    disabled={disabled}
                                >
                                    {t('config_management.visual.common.delete')}
                                </Button>
                            </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button variant='secondary' size='sm' onClick={() => addModel(ruleIndex)}
                                    disabled={disabled}>
                                {t('config_management.visual.payload_rules.add_model')}
                            </Button>
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div className={styles.fieldLabel}>{t('config_management.visual.payload_rules.params')}</div>
                        {(rule.params.length ? rule.params : []).map((param, paramIndex) => (
                            <div key={param.id} className={styles.payloadRuleParamRow}>
                                <input
                                    className='input'
                                    placeholder={t('config_management.visual.payload_rules.json_path')}
                                    value={param.path}
                                    onChange={(e) => updateParam(ruleIndex, paramIndex, { path: e.target.value })}
                                    disabled={disabled}
                                />
                                <Select
                                    value={param.valueType}
                                    options={payloadValueTypeOptions}
                                    disabled={disabled}
                                    ariaLabel={t('config_management.visual.payload_rules.param_type')}
                                    onChange={(nextValue) =>
                                        updateParam(ruleIndex, paramIndex, {
                                            valueType: nextValue as PayloadParamValueType,
                                        })
                                    }
                                />
                                <input
                                    className='input'
                                    placeholder={getValuePlaceholder(param.valueType)}
                                    value={param.value}
                                    onChange={(e) => updateParam(ruleIndex, paramIndex, { value: e.target.value })}
                                    disabled={disabled}
                                />
                                <Button
                                    variant='ghost'
                                    size='sm'
                                    className={styles.payloadRowActionButton}
                                    onClick={() => removeParam(ruleIndex, paramIndex)}
                                    disabled={disabled}
                                >
                                    {t('config_management.visual.common.delete')}
                                </Button>
                            </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button variant='secondary' size='sm' onClick={() => addParam(ruleIndex)}
                                    disabled={disabled}>
                                {t('config_management.visual.payload_rules.add_param')}
                            </Button>
                        </div>
                    </div>
                </div>
            ))}

            {rules.length === 0 && (
                <div className={styles.emptyState}>{t('config_management.visual.payload_rules.no_rules')}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant='secondary' size='sm' onClick={addRule} disabled={disabled}>
                    {t('config_management.visual.payload_rules.add_rule')}
                </Button>
            </div>
        </div>
    )
}

function PayloadFilterRulesEditor({
                                      value,
                                      disabled,
                                      onChange,
                                  }: {
    value: PayloadFilterRule[];
    disabled?: boolean;
    onChange: (next: PayloadFilterRule[]) => void;
}) {
    const { t }           = useTranslation()
    const rules           = value.length ? value : []
    const protocolOptions = useMemo(
        () =>
            VISUAL_CONFIG_PROTOCOL_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey, { defaultValue: option.defaultLabel }),
            })),
        [t],
    )

    const { addRule, removeRule, updateRule, addModel, removeModel, updateModel } = buildRuleCrud(rules, onChange)

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rules.map((rule, ruleIndex) => (
                <div
                    key={rule.id}
                    style={{
                        border: '1px solid var(--border-color)',
                        borderRadius: 12,
                        padding: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 12,
                            flexWrap: 'wrap',
                        }}
                    >
                        <div className={styles.label}>
                            {t('config_management.visual.payload_rules.rule')} {ruleIndex + 1}
                        </div>
                        <Button variant='ghost' size='sm' onClick={() => removeRule(ruleIndex)} disabled={disabled}>
                            {t('config_management.visual.common.delete')}
                        </Button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div className={styles.fieldLabel}>{t('config_management.visual.payload_rules.models')}</div>
                        {rule.models.map((model, modelIndex) => (
                            <div key={model.id} className={styles.payloadFilterModelRow}>
                                <input
                                    className='input'
                                    placeholder={t('config_management.visual.payload_rules.model_name')}
                                    value={model.name}
                                    onChange={(e) => updateModel(ruleIndex, modelIndex, { name: e.target.value })}
                                    disabled={disabled}
                                />
                                <Select
                                    value={model.protocol ?? ''}
                                    options={protocolOptions}
                                    disabled={disabled}
                                    ariaLabel={t('config_management.visual.payload_rules.provider_type')}
                                    onChange={(nextValue) =>
                                        updateModel(ruleIndex, modelIndex, {
                                            protocol: (nextValue || undefined) as PayloadModelEntry['protocol'],
                                        })
                                    }
                                />
                                <Button
                                    variant='ghost'
                                    size='sm'
                                    className={styles.payloadRowActionButton}
                                    onClick={() => removeModel(ruleIndex, modelIndex)}
                                    disabled={disabled}
                                >
                                    {t('config_management.visual.common.delete')}
                                </Button>
                            </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button variant='secondary' size='sm' onClick={() => addModel(ruleIndex)}
                                    disabled={disabled}>
                                {t('config_management.visual.payload_rules.add_model')}
                            </Button>
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div
                            className={styles.fieldLabel}>{t('config_management.visual.payload_rules.remove_params')}</div>
                        <StringListEditor
                            value={rule.params}
                            disabled={disabled}
                            placeholder={t('config_management.visual.payload_rules.json_path_filter')}
                            onChange={(params) => updateRule(ruleIndex, { params })}
                        />
                    </div>
                </div>
            ))}

            {rules.length === 0 && (
                <div className={styles.emptyState}>{t('config_management.visual.payload_rules.no_rules')}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant='secondary' size='sm' onClick={addRule} disabled={disabled}>
                    {t('config_management.visual.payload_rules.add_rule')}
                </Button>
            </div>
        </div>
    )
}

export function VisualConfigEditor({ values, disabled = false, onChange }: VisualConfigEditorProps) {
    const { t }                        = useTranslation()
    const isKeepaliveDisabled          = values.streaming.keepaliveSeconds ===
                                         '' ||
                                         values.streaming.keepaliveSeconds ===
                                         '0'
    const isNonstreamKeepaliveDisabled =
              values.streaming.nonstreamKeepaliveInterval === '' || values.streaming.nonstreamKeepaliveInterval === '0'

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ConfigSection
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
                    />
                    <Input
                        label={t('config_management.visual.sections.server.port')}
                        type='number'
                        placeholder='8317'
                        value={values.port}
                        onChange={(e) => onChange({ port: e.target.value })}
                        disabled={disabled}
                    />
                </SectionGrid>
            </ConfigSection>

            <ConfigSection
                title={t('config_management.visual.sections.tls.title')}
                description={t('config_management.visual.sections.tls.description')}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <ToggleRow
                        title={t('config_management.visual.sections.tls.enable')}
                        description={t('config_management.visual.sections.tls.enable_desc')}
                        checked={values.tlsEnable}
                        disabled={disabled}
                        onChange={(tlsEnable) => onChange({ tlsEnable })}
                    />
                    {values.tlsEnable && (
                        <>
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
                            </SectionGrid>
                        </>
                    )}
                </div>
            </ConfigSection>

            <ConfigSection
                title={t('config_management.visual.sections.remote.title')}
                description={t('config_management.visual.sections.remote.description')}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                    <SectionGrid>
                        <Input
                            label={t('config_management.visual.sections.remote.secret_key')}
                            type='password'
                            placeholder={t('config_management.visual.sections.remote.secret_key_placeholder')}
                            value={values.rmSecretKey}
                            onChange={(e) => onChange({ rmSecretKey: e.target.value })}
                            disabled={disabled}
                        />
                        <Input
                            label={t('config_management.visual.sections.remote.panel_repo')}
                            placeholder='https://github.com/Pyrokine/Cli-Proxy-API-Management-Center'
                            value={values.rmPanelRepo}
                            onChange={(e) => onChange({ rmPanelRepo: e.target.value })}
                            disabled={disabled}
                        />
                        <Input
                            label={t('config_management.visual.sections.remote.cpa_repo')}
                            placeholder='https://github.com/Pyrokine/CLIProxyAPI'
                            value={values.rmCpaRepo}
                            onChange={(e) => onChange({ rmCpaRepo: e.target.value })}
                            disabled={disabled}
                        />
                    </SectionGrid>
                </div>
            </ConfigSection>

            <ConfigSection
                title={t('config_management.visual.sections.auth.title')}
                description={t('config_management.visual.sections.auth.description')}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <Input
                        label={t('config_management.visual.sections.auth.auth_dir')}
                        placeholder='~/.cli-proxy-api'
                        value={values.authDir}
                        onChange={(e) => onChange({ authDir: e.target.value })}
                        disabled={disabled}
                        hint={t('config_management.visual.sections.auth.auth_dir_hint')}
                    />
                    <Input
                        label={t('config_management.visual.sections.auth.usage_data_dir')}
                        placeholder='~/.cli-proxy-api/usage'
                        value={values.usageDataDir}
                        onChange={(e) => onChange({ usageDataDir: e.target.value })}
                        disabled={disabled}
                        hint={t('config_management.visual.sections.auth.usage_data_dir_hint')}
                    />
                    <ApiKeysCardEditor
                        value={values.apiKeysText}
                        disabled={disabled}
                        onChange={(apiKeysText) => onChange({ apiKeysText })}
                    />
                </div>
            </ConfigSection>

            <ConfigSection
                title={t('config_management.visual.sections.system.title')}
                description={t('config_management.visual.sections.system.description')}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                            type='number'
                            placeholder='0'
                            value={values.logsMaxTotalSizeMb}
                            onChange={(e) => onChange({ logsMaxTotalSizeMb: e.target.value })}
                            disabled={disabled}
                        />
                    </SectionGrid>
                </div>
            </ConfigSection>

            <ConfigSection
                title={t('config_management.visual.sections.network.title')}
                description={t('config_management.visual.sections.network.description')}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                        />
                        <Input
                            label={t('config_management.visual.sections.network.max_retry_interval')}
                            type='number'
                            placeholder='30'
                            value={values.maxRetryInterval}
                            onChange={(e) => onChange({ maxRetryInterval: e.target.value })}
                            disabled={disabled}
                        />
                        <div className='form-group'>
                            <label>{t('config_management.visual.sections.network.routing_strategy')}</label>
                            <Select
                                value={values.routingStrategy}
                                options={[
                                    {
                                        value: 'round-robin',
                                        label: t('config_management.visual.sections.network.strategy_round_robin'),
                                    },
                                    {
                                        value: 'fill-first',
                                        label: t('config_management.visual.sections.network.strategy_fill_first'),
                                    },
                                ]}
                                disabled={disabled}
                                ariaLabel={t('config_management.visual.sections.network.routing_strategy')}
                                onChange={(nextValue) =>
                                    onChange({ routingStrategy: nextValue as VisualConfigValues['routingStrategy'] })
                                }
                            />
                            <div
                                className='hint'>{t('config_management.visual.sections.network.routing_strategy_hint')}</div>
                        </div>
                    </SectionGrid>

                    <ToggleRow
                        title={t('config_management.visual.sections.network.force_model_prefix')}
                        description={t('config_management.visual.sections.network.force_model_prefix_desc')}
                        checked={values.forceModelPrefix}
                        disabled={disabled}
                        onChange={(forceModelPrefix) => onChange({ forceModelPrefix })}
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
                </div>
            </ConfigSection>

            <ConfigSection
                title={t('config_management.visual.sections.quota.title')}
                description={t('config_management.visual.sections.quota.description')}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                </div>
            </ConfigSection>

            <ConfigSection
                title={t('config_management.visual.sections.streaming.title')}
                description={t('config_management.visual.sections.streaming.description')}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <SectionGrid>
                        <div className='form-group'>
                            <label>{t('config_management.visual.sections.streaming.keepalive_seconds')}</label>
                            <div style={{ position: 'relative' }}>
                                <input
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
                                {isKeepaliveDisabled && (
                                    <span className={styles.disabledBadge}>
                    {t('config_management.visual.sections.streaming.disabled')}
                  </span>
                                )}
                            </div>
                            <div
                                className='hint'>{t('config_management.visual.sections.streaming.keepalive_hint')}</div>
                        </div>
                        <Input
                            label={t('config_management.visual.sections.streaming.bootstrap_retries')}
                            type='number'
                            placeholder='1'
                            value={values.streaming.bootstrapRetries}
                            onChange={(e) => onChange({
                                                          streaming: {
                                                              ...values.streaming,
                                                              bootstrapRetries: e.target.value,
                                                          },
                                                      })}
                            disabled={disabled}
                            hint={t('config_management.visual.sections.streaming.bootstrap_hint')}
                        />
                    </SectionGrid>

                    <SectionGrid>
                        <div className='form-group'>
                            <label>{t('config_management.visual.sections.streaming.nonstream_keepalive')}</label>
                            <div style={{ position: 'relative' }}>
                                <input
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
                                {isNonstreamKeepaliveDisabled && (
                                    <span className={styles.disabledBadge}>
                    {t('config_management.visual.sections.streaming.disabled')}
                  </span>
                                )}
                            </div>
                            <div className='hint'>{t(
                                'config_management.visual.sections.streaming.nonstream_keepalive_hint')}</div>
                        </div>
                    </SectionGrid>
                </div>
            </ConfigSection>

            <ConfigSection
                title={t('config_management.visual.sections.payload.title')}
                description={t('config_management.visual.sections.payload.description')}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                        <div className={styles.label} style={{ marginBottom: 6 }}>
                            {t('config_management.visual.sections.payload.default_rules')}
                        </div>
                        <div className={styles.desc} style={{ marginBottom: 12 }}>
                            {t('config_management.visual.sections.payload.default_rules_desc')}
                        </div>
                        <PayloadRulesEditor
                            value={values.payloadDefaultRules}
                            disabled={disabled}
                            onChange={(payloadDefaultRules) => onChange({ payloadDefaultRules })}
                        />
                    </div>

                    <div>
                        <div className={styles.label} style={{ marginBottom: 6 }}>
                            {t('config_management.visual.sections.payload.override_rules')}
                        </div>
                        <div className={styles.desc} style={{ marginBottom: 12 }}>
                            {t('config_management.visual.sections.payload.override_rules_desc')}
                        </div>
                        <PayloadRulesEditor
                            value={values.payloadOverrideRules}
                            disabled={disabled}
                            protocolFirst
                            onChange={(payloadOverrideRules) => onChange({ payloadOverrideRules })}
                        />
                    </div>

                    <div>
                        <div className={styles.label} style={{ marginBottom: 6 }}>
                            {t('config_management.visual.sections.payload.filter_rules')}
                        </div>
                        <div className={styles.desc} style={{ marginBottom: 12 }}>
                            {t('config_management.visual.sections.payload.filter_rules_desc')}
                        </div>
                        <PayloadFilterRulesEditor
                            value={values.payloadFilterRules}
                            disabled={disabled}
                            onChange={(payloadFilterRules) => onChange({ payloadFilterRules })}
                        />
                    </div>
                </div>
            </ConfigSection>
        </div>
    )
}
