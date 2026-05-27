import {FloatingEditActions} from '@/components/common/FloatingEditActions'
import {SecondaryScreenShell} from '@/components/common/SecondaryScreenShell'
import {Card} from '@/components/ui/Card'
import type {ReactNode, RefObject} from 'react'
import {useTranslation} from 'react-i18next'
import layoutStyles from './ProviderEditLayout.module.scss'

interface ProviderEditShellProps {
    title: string
    loading: boolean
    saving: boolean
    canSave: boolean
    error?: string
    invalidIndexParam?: boolean
    invalidIndex?: boolean
    onBack: () => void
    onSave: () => void
    swipeRef: RefObject<HTMLDivElement | null>
    children: ReactNode
}

/**
 * Shared page shell for all provider edit pages.
 * Wraps SecondaryScreenShell + FloatingEditActions + Card with error/invalid state.
 */
export function ProviderEditShell({
                                      title,
                                      loading,
                                      saving,
                                      canSave,
                                      error,
                                      invalidIndexParam,
                                      invalidIndex,
                                      onBack,
                                      onSave,
                                      swipeRef,
                                      children,
                                  }: ProviderEditShellProps) {
    const { t } = useTranslation()

    return (
        <SecondaryScreenShell
            ref={swipeRef}
            contentClassName={layoutStyles.content}
            title={title}
            onBack={onBack}
            backLabel={t('common.back')}
            backAriaLabel={t('common.back')}
            hideTopBarBackButton
            hideTopBarRightAction
            floatingAction={<FloatingEditActions onBack={onBack} onSave={onSave} saving={saving} canSave={canSave} />}
            isLoading={loading}
            loadingLabel={t('common.loading')}
        >
            <Card>
                {error && <div className='error-box'>{error}</div>}
                {invalidIndexParam || invalidIndex ? (
                    <div className='hint'>{t('common.invalid_provider_index')}</div>
                ) : (
                     children
                 )}
            </Card>
        </SecondaryScreenShell>
    )
}
