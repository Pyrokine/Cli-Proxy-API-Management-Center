import {Button} from '@/components/ui/Button'
import {Select} from '@/components/ui/Select'
import styles from '@/pages/ProviderEditForm.module.scss'
import type {Dispatch, SetStateAction} from 'react'
import {useTranslation} from 'react-i18next'

interface ModelTestPanelProps {
    testModel: string
    setTestModel: Dispatch<SetStateAction<string>>
    testStatus: 'idle' | 'loading' | 'success' | 'error'
    setTestStatus: Dispatch<SetStateAction<'idle' | 'loading' | 'success' | 'error'>>
    testMessage: string
    setTestMessage: Dispatch<SetStateAction<string>>
    modelSelectOptions: Array<{ value: string; label: string }>
    availableModels: string[]
    isTesting: boolean
    /** Whether controls should be disabled (saving / disconnected) */
    disabled: boolean
    /** i18n key prefix for labels (e.g. 'ai_providers.claude' or 'ai_providers.openai') */
    i18nPrefix: string
    /** Callback to run the test */
    onTest: () => void
    /** Additional disabled condition for the test button */
    testButtonDisabled?: boolean
    /** Override the test button label (defaults to `{i18nPrefix}_test_action`) */
    testButtonLabel?: string
    /** HTML title attribute for the test button */
    testButtonTitle?: string
}

/**
 * Shared model connectivity test panel: model select, test button, and status badge.
 */
export function ModelTestPanel({
                                   testModel,
                                   setTestModel,
                                   testStatus,
                                   setTestStatus,
                                   testMessage,
                                   setTestMessage,
                                   modelSelectOptions,
                                   availableModels,
                                   isTesting,
                                   disabled,
                                   i18nPrefix,
                                   onTest,
                                   testButtonDisabled,
                                   testButtonLabel,
                                   testButtonTitle,
                               }: ModelTestPanelProps) {
    const { t } = useTranslation()

    return (
        <>
            <div className={styles.modelTestPanel}>
                <div className={styles.modelTestMeta}>
                    <label className={styles.modelTestLabel}>{t(`${i18nPrefix}_test_title`)}</label>
                    <span className={styles.modelTestHint}>{t(`${i18nPrefix}_test_hint`)}</span>
                </div>
                <div className={styles.modelTestControls}>
                    <Select
                        value={testModel}
                        options={modelSelectOptions}
                        onChange={(value) => {
                            setTestModel(value)
                            setTestStatus('idle')
                            setTestMessage('')
                        }}
                        placeholder={
                            availableModels.length
                            ? t(`${i18nPrefix}_test_select_placeholder`)
                            : t(`${i18nPrefix}_test_select_empty`)
                        }
                        className={styles.openaiTestSelect}
                        ariaLabel={t(`${i18nPrefix}_test_title`)}
                        disabled={disabled || isTesting || testStatus === 'loading' || availableModels.length === 0}
                    />
                    <Button
                        variant={testStatus === 'error' ? 'danger' : 'secondary'}
                        size='sm'
                        onClick={onTest}
                        loading={testStatus === 'loading'}
                        disabled={
                            disabled ||
                            isTesting ||
                            testStatus === 'loading' ||
                            testButtonDisabled ||
                            availableModels.length === 0
                        }
                        title={testButtonTitle}
                        className={styles.modelTestAllButton}
                    >
                        {testButtonLabel ?? t(`${i18nPrefix}_test_action`)}
                    </Button>
                </div>
            </div>

            {testMessage && (
                <div
                    className={`status-badge ${
                        testStatus === 'error' ? 'error' : testStatus === 'success' ? 'success' : 'muted'
                    }`}
                >
                    {testMessage}
                </div>
            )}
        </>
    )
}
