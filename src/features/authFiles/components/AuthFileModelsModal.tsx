import {Button} from '@/components/ui/Button'
import {EmptyState} from '@/components/ui/EmptyState'
import {Modal} from '@/components/ui/Modal'
import {Pagination} from '@/components/ui/Pagination'
import {invalidateAuthFileModelsCache, loadAuthFileModels} from '@/features/authFiles/authFileModelsCache'
import {normalizeAuthFileProvider} from '@/features/authFiles/constants'
import {usePagination} from '@/hooks/usePagination'
import {authFilesApi} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'
import {useAuthStore, useConfigStore, useNotificationStore} from '@/stores'
import type {AuthFileItem, AuthFileModelItem} from '@/types/authFile'
import {copyToClipboard} from '@/utils/clipboard'
import {isModelExcludedByRules} from '@/utils/excludedModels'
import {useEffect, useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './AuthFileModelsModal.module.scss'

interface ModelsState {
    identity: string
    models: AuthFileModelItem[]
    loading: boolean
    error: string | null
    unsupported: boolean
}

export function AuthFileModelsModal({ file, onClose }: { file: AuthFileItem | null; onClose: () => void }) {
    const { t }             = useTranslation()
    const generation        = useAuthStore(() => apiClient.getAuthGeneration())
    const excluded          = useConfigStore((state) => state.config?.oauthExcludedModels)
    const showNotification  = useNotificationStore((state) => state.showNotification)
    const [retry, setRetry] = useState(0)
    const [state, setState] = useState<ModelsState>({
                                                        identity: '',
                                                        models: [],
                                                        loading: true,
                                                        error: null,
                                                        unsupported: false,
                                                    })
    const identity          = `${generation}:${file?.name ?? ''}`
    const current           = state.identity === identity ?
                              state :
        { identity, models: [], loading: true, error: null, unsupported: false }
    const pagination        = usePagination(current.models)
    const provider          = normalizeAuthFileProvider(String(file?.provider || file?.type || ''))
    const rules             = [...(excluded?.[provider] ?? []), ...(file?.excludedModels ?? [])]

    useEffect(() => {
        if (!file) {
            return
        }
        let active = true
        queueMicrotask(() => {
            if (active) {
                setState({ identity, models: [], loading: true, error: null, unsupported: false })
            }
        })
        void loadAuthFileModels(file.name, authFilesApi.getModelsForAuthFile)
            .then((models) => {
                if (!active || generation !== apiClient.getAuthGeneration()) {
                    return
                }
                setState({
                             identity,
                             models: models ?? [],
                             loading: false,
                             error: models === null ? t('notification.load_failed') : null,
                             unsupported: false,
                         })
            })
            .catch((error: unknown) => {
                if (!active || generation !== apiClient.getAuthGeneration()) {
                    return
                }
                const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined
                setState({
                             identity,
                             models: [],
                             loading: false,
                             error: error instanceof Error ? error.message : String(error),
                             unsupported: status === 404 || status === 501,
                         })
            })
        return () => {
            active = false
        }
    }, [file, generation, identity, retry, t])

    const reload    = () => {
        if (file) {
            invalidateAuthFileModelsCache([file.name]);
            setRetry((value) => value + 1)
        }
    }
    const copyModel = async (id: string) => {
        const copied = await copyToClipboard(id)
        if (generation === apiClient.getAuthGeneration()) {
            showNotification(
                t(copied ? 'common.copied' : 'credentials.models_copy_failed'),
                copied ? 'success' : 'error',
            )
        }
    }

    return (
        <Modal open={Boolean(file)} onClose={onClose} title={`${t('auth_files.models_title')} — ${file?.name ?? ''}`}
               footer={<Button variant='secondary' onClick={onClose}>{t('common.close')}</Button>}>
            {current.loading ?
             <div role='status'>{t('auth_files.models_loading')}</div>
                             :
             current.unsupported ?
             <EmptyState title={t('auth_files.models_unsupported')}
                         description={t('auth_files.models_unsupported_desc')} />
                                 :
             current.error ?
             <div role='alert'>
                 <div className='error-box'>{current.error}</div>
                 <Button variant='secondary' onClick={reload}>{t('common.retry')}</Button></div>
                           :
             current.models.length === 0 ?
             <EmptyState title={t('auth_files.models_empty')} description={t('auth_files.models_empty_desc')} />
                                         :
             <>
                 <div className={styles.modelsList}>
                     {pagination.currentItems.map((model) => {
                         const disabled = isModelExcludedByRules(rules, model.id)
                         return <button key={model.id} type='button'
                                        className={`${styles.model} ${disabled ? styles.excluded : ''}`}
                                        onClick={() => void copyModel(model.id)} title={t('common.copy')}>
                             <span className={styles.modelId}>{model.id}</span>
                             {model.display_name &&
                              model.display_name !==
                              model.id &&
                              <span>{model.display_name}</span>}
                             {model.type && <span className={styles.modelType}>{model.type}</span>}
                             {disabled &&
                              <span
                                  title={t('auth_files.models_excluded_hint')}>{t(
                                  'auth_files.models_excluded_badge')}</span>}
                         </button>
                     })}
                 </div>
                 <Pagination total={current.models.length} page={pagination.currentPage} pageSize={pagination.pageSize}
                             onPageChange={pagination.goToPage} />
             </>}
        </Modal>
    )
}
