import {SecondaryScreenShell} from '@/components/common/SecondaryScreenShell'
import {Button} from '@/components/ui/Button'
import {Card} from '@/components/ui/Card'
import {Modal} from '@/components/ui/Modal'
import {useProviderEditPresentation} from '@/hooks/useProviderEditPresentation'
import type {ReactNode, RefObject} from 'react'
import {useTranslation} from 'react-i18next'
import layoutStyles from './ProviderEditLayout.module.scss'

interface ProviderPresentationShellProps {
    title: string
    loading: boolean
    closeDisabled: boolean
    onBack: () => void
    swipeRef: RefObject<HTMLDivElement | null>
    presentation: ReturnType<typeof useProviderEditPresentation>
    initialFocusId?: string
    returnFocusId?: string
    renderPrimaryAction: (mode: 'modal' | 'screen') => ReactNode
    children: ReactNode
}

export function ProviderPresentationShell({
                                              title,
                                              loading,
                                              closeDisabled,
                                              onBack,
                                              swipeRef,
                                              presentation,
                                              initialFocusId,
                                              returnFocusId,
                                              renderPrimaryAction,
                                              children,
                                          }: ProviderPresentationShellProps) {
    const { t } = useTranslation()

    if (presentation) {
        return (
            <Modal
                open
                title={title}
                onClose={onBack}
                width='min(1040px, 94vw)'
                className={layoutStyles.providerModal}
                overlayClassName={layoutStyles.providerModalOverlay}
                closeDisabled={closeDisabled}
                closeBehavior='immediate'
                closeLabel={t('common.close')}
                initialFocusId={initialFocusId}
                returnFocusId={returnFocusId ?? presentation.returnFocusId}
                footer={
                    <>
                        <Button variant='secondary' onClick={onBack} disabled={closeDisabled}>
                            {t('common.cancel')}
                        </Button>
                        {renderPrimaryAction('modal')}
                    </>
                }
            >
                <div ref={swipeRef} className={layoutStyles.providerModalContent}>
                    {loading ? (
                        <div className={layoutStyles.providerModalLoading}>
                            <span className='loading-spinner' aria-hidden='true' />
                            <span>{t('common.loading')}</span>
                        </div>
                    ) : children}
                </div>
            </Modal>
        )
    }

    return (
        <SecondaryScreenShell
            ref={swipeRef}
            contentClassName={layoutStyles.content}
            title={title}
            onBack={onBack}
            backLabel={t('common.back')}
            backAriaLabel={t('common.back')}
            rightAction={renderPrimaryAction('screen')}
            isLoading={loading}
            loadingLabel={t('common.loading')}
        >
            {children}
        </SecondaryScreenShell>
    )
}

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
 * Shared shell for provider edit pages. List-originated routes use a large modal;
 * direct links and refreshed routes keep the full-page presentation.
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
    const { t }        = useTranslation()
    const presentation = useProviderEditPresentation()
    const content      = (
        <Card>
            {error && <div className='error-box'>{error}</div>}
            {invalidIndexParam || invalidIndex ? (
                <div className='hint'>{t('common.invalid_provider_index')}</div>
            ) : (
                 children
             )}
        </Card>
    )

    return (
        <ProviderPresentationShell
            title={title}
            loading={loading}
            closeDisabled={saving}
            onBack={onBack}
            swipeRef={swipeRef}
            presentation={presentation}
            initialFocusId={presentation?.childReturnFocusId}
            renderPrimaryAction={(mode) => (
                <Button
                    size={mode === 'screen' ? 'sm' : undefined}
                    onClick={onSave}
                    loading={saving}
                    disabled={!canSave}
                    className={mode === 'screen' ? layoutStyles.floatingSaveButton : undefined}
                >
                    {t('common.save')}
                </Button>
            )}
        >
            {content}
        </ProviderPresentationShell>
    )
}
