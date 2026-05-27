import {ModelConfigSection} from '@/components/common/ModelConfigSection'
import {buildApiKeyEntry} from '@/components/providers/utils'
import {Button} from '@/components/ui/Button'
import {Input} from '@/components/ui/Input'
import {ToggleSwitch} from '@/components/ui/ToggleSwitch'
import {useEdgeSwipeBack} from '@/hooks/useEdgeSwipeBack'
import {useEscapeKey} from '@/hooks/useEscapeKey'
import {useNotificationStore} from '@/stores'
import type {ApiKeyEntry} from '@/types'
import {useTranslation} from 'react-i18next'
import {useNavigate, useOutletContext} from 'react-router-dom'
import type {OpenAIEditOutletContext} from './AiProvidersOpenAIEditLayout'
import styles from './ProviderEditForm.module.scss'
import {ProviderEditShell} from './ProviderEditShell'
import {HeadersField, PrefixField, PriorityField} from './ProviderFormFields'

export function AiProvidersOpenAIEditPage() {
    const { t }                = useTranslation()
    const navigate             = useNavigate()
    const { showNotification } = useNotificationStore()
    const {
              hasIndexParam,
              invalidIndexParam,
              invalidIndex,
              disableControls,
              loading,
              saving,
              form,
              setForm,
              handleBack,
              handleSave,
          }                    = useOutletContext<OpenAIEditOutletContext>()

    const title = hasIndexParam ? t('ai_providers.openai_edit_modal_title') : t('ai_providers.openai_add_modal_title')

    const swipeRef = useEdgeSwipeBack({ onBack: handleBack })

    useEscapeKey(handleBack)

    const canSave          = !disableControls && !loading && !saving && !invalidIndexParam && !invalidIndex
    const controlsDisabled = saving || disableControls

    const openOpenaiModelDiscovery = () => {
        const baseUrl = form.baseUrl.trim()
        if (!baseUrl) {
            showNotification(t('ai_providers.openai_models_fetch_invalid_url'), 'error')
            return
        }
        navigate('models')
    }

    const renderKeyEntries = (entries: ApiKeyEntry[]) => {
        const list = entries.length ? entries : [buildApiKeyEntry()]

        const updateEntry = (idx: number, field: keyof ApiKeyEntry, value: string) => {
            const next = list.map((entry, i) => (i === idx ? { ...entry, [field]: value } : entry))
            setForm((prev) => ({ ...prev, apiKeyEntries: next }))
        }

        const removeEntry = (idx: number) => {
            const next = list.filter((_, i) => i !== idx)
            setForm((prev) => ({
                ...prev,
                apiKeyEntries: next.length ? next : [buildApiKeyEntry()],
            }))
        }

        const addEntry = () => {
            setForm((prev) => ({ ...prev, apiKeyEntries: [...list, buildApiKeyEntry()] }))
        }

        return (
            <div className={styles.keyEntriesList}>
                <div className={styles.keyEntriesToolbar}>
                    <span className={styles.keyEntriesCount}>
                        {t('ai_providers.openai_keys_count')}: {list.length}
                    </span>
                    <Button
                        variant='secondary'
                        size='sm'
                        onClick={addEntry}
                        disabled={controlsDisabled}
                        className={styles.addKeyButton}
                    >
                        {t('ai_providers.openai_keys_add_btn')}
                    </Button>
                </div>
                <div className={styles.keyTableShell}>
                    <div className={styles.keyTableHeader}>
                        <div className={styles.keyTableColIndex}>#</div>
                        <div className={styles.keyTableColKey}>{t('common.api_key')}</div>
                        <div className={styles.keyTableColProxy}>{t('common.proxy_url')}</div>
                        <div className={styles.keyTableColAction}>{t('common.action')}</div>
                    </div>

                    {list.map((entry, index) => (
                        <div key={index} className={styles.keyTableRow}>
                            <div className={styles.keyTableColIndex}>{index + 1}</div>

                            <div className={styles.keyTableColKey}>
                                <input
                                    type='text'
                                    value={entry.apiKey}
                                    onChange={(e) => updateEntry(index, 'apiKey', e.target.value)}
                                    disabled={controlsDisabled}
                                    className={`input ${styles.keyTableInput}`}
                                    placeholder={t('ai_providers.openai_key_placeholder')}
                                />
                            </div>

                            <div className={styles.keyTableColProxy}>
                                <input
                                    type='text'
                                    value={entry.proxyUrl ?? ''}
                                    onChange={(e) => updateEntry(index, 'proxyUrl', e.target.value)}
                                    disabled={controlsDisabled}
                                    className={`input ${styles.keyTableInput}`}
                                    placeholder={t('ai_providers.openai_proxy_placeholder')}
                                />
                            </div>

                            <div className={styles.keyTableColAction}>
                                <Button
                                    variant='ghost'
                                    size='sm'
                                    onClick={() => removeEntry(index)}
                                    disabled={controlsDisabled || list.length <= 1}
                                >
                                    {t('common.delete')}
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <ProviderEditShell
            swipeRef={swipeRef}
            title={title}
            loading={loading}
            saving={saving}
            canSave={canSave}
            invalidIndexParam={invalidIndexParam}
            invalidIndex={invalidIndex}
            onBack={handleBack}
            onSave={() => void handleSave()}
        >
            <div className={styles.openaiEditForm}>
                <Input
                    label={t('ai_providers.openai_add_modal_name_label')}
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    disabled={controlsDisabled}
                />
                <PriorityField form={form} setForm={setForm} disabled={controlsDisabled} />
                <PrefixField form={form} setForm={setForm} disabled={controlsDisabled} />
                <Input
                    label={t('ai_providers.openai_add_modal_url_label')}
                    value={form.baseUrl}
                    onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                    disabled={controlsDisabled}
                />
                <div className='form-group'>
                    <ToggleSwitch
                        label={t('ai_providers.openai_disabled_label')}
                        checked={Boolean(form.disabled)}
                        onChange={(value) => setForm((prev) => ({ ...prev, disabled: value }))}
                        disabled={controlsDisabled}
                        ariaLabel={t('ai_providers.openai_disabled_label')}
                    />
                    <div className='hint'>{t('ai_providers.openai_disabled_hint')}</div>
                </div>

                <HeadersField
                    entries={form.headers}
                    onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
                    disabled={controlsDisabled}
                />

                <ModelConfigSection
                    title={
                        hasIndexParam
                        ? t('ai_providers.openai_edit_modal_models_label')
                        : t('ai_providers.openai_add_modal_models_label')
                    }
                    hint={t('ai_providers.openai_models_hint')}
                    addLabel={t('ai_providers.openai_models_add_btn')}
                    fetchLabel={t('ai_providers.openai_models_fetch_button')}
                    entries={form.modelEntries}
                    setForm={setForm}
                    onFetchModels={openOpenaiModelDiscovery}
                    disabled={controlsDisabled}
                />

                <div className={styles.keyEntriesSection}>
                    <div className={styles.keyEntriesHeader}>
                        <label className={styles.keyEntriesTitle}>
                            {t('ai_providers.openai_add_modal_keys_label')}
                        </label>
                        <span className={styles.keyEntriesHint}>{t('ai_providers.openai_keys_hint')}</span>
                    </div>
                    {renderKeyEntries(form.apiKeyEntries)}
                </div>
            </div>
        </ProviderEditShell>
    )
}
