import type {ManualKeyCardItem} from '@/components/credentials/apiKeyStatus'
import type {AuthFileMutation} from '@/components/credentials/credentialsDataLifecycle'
import {downloadAuthFilesBatch} from '@/features/authFiles/batchDownload'
import {
    isAuthFileUploadInFlight,
    subscribeAuthFileUploadLock,
    withAuthFileUploadLock,
} from '@/features/authFiles/uploadLock'
import {authFilesApi} from '@/services/api/authFiles'
import {apiClient} from '@/services/api/client'
import {providersApi} from '@/services/api/providers'
import {useNotificationStore} from '@/stores'
import type {OpenAIProviderConfig} from '@/types'
import type {AuthFileItem} from '@/types/authFile'
import {useCallback, useSyncExternalStore} from 'react'
import {useTranslation} from 'react-i18next'

type ApiKeyDeleter = (identifier: string, baseUrl?: string, entryRef?: string) => Promise<unknown>
type MutationCompleter = (mutation: AuthFileMutation | AuthFileMutation[]) => Promise<void>

const API_KEY_DELETERS: Record<string, ApiKeyDeleter> = {
    gemini: (...args) => providersApi.deleteGeminiKey(...args),
    interactions: (...args) => providersApi.deleteInteractionsKey(...args),
    claude: (...args) => providersApi.deleteClaudeConfig(...args),
    codex: (...args) => providersApi.deleteCodexConfig(...args),
    meta: (...args) => providersApi.deleteMetaConfig(...args),
    xai: (...args) => providersApi.deleteXAIConfig(...args),
    vertex: (...args) => providersApi.deleteVertexConfig(...args),
    openai: (name) => providersApi.deleteOpenAIProvider(name),
}

const DELETE_CONFIRM_KEYS: Record<string, string> = {
    gemini: 'ai_providers.gemini_delete_confirm',
    interactions: 'ai_providers.interactions_delete_confirm',
    claude: 'ai_providers.claude_delete_confirm',
    codex: 'ai_providers.codex_delete_confirm',
    meta: 'ai_providers.meta_delete_confirm',
    xai: 'ai_providers.xai_delete_confirm',
    vertex: 'ai_providers.vertex_delete_confirm',
    openai: 'ai_providers.openai_delete_confirm',
}

export function useVendorActions(
    vendorId: string,
    onRefresh: () => Promise<void>,
    completeMutation: MutationCompleter,
) {
    const { t } = useTranslation()
    const showNotification = useNotificationStore((state) => state.showNotification)
    const showConfirmation = useNotificationStore((state) => state.showConfirmation)
    const uploadInFlight = useSyncExternalStore(
        subscribeAuthFileUploadLock,
        isAuthFileUploadInFlight,
        isAuthFileUploadInFlight,
    )

    const deleteApiKey = useCallback(
        (identifier: string, baseUrl?: string, item?: ManualKeyCardItem) => {
            const deleter = API_KEY_DELETERS[vendorId]
            if (!deleter) {
                return
            }
            const deletingEntry = vendorId === 'openai' && item?.entryIndex !== undefined
            const confirmKey    = deletingEntry ?
                                  'ai_providers.openai_remove_key_confirm' :
                                  DELETE_CONFIRM_KEYS[vendorId] ?? 'api_keys.delete_confirm'
            const generation    = apiClient.getAuthGeneration()
            showConfirmation(
                {
                    title: t('common.delete'),
                    message: t(confirmKey),
                    variant: 'danger',
                    confirmText: t('common.delete'),
                    cancelText: t('common.cancel'),
                    onConfirm: async () => {
                        if (generation !== apiClient.getAuthGeneration()) {
                            throw new Error(t('common.connection_changed'))
                        }
                        try {
                            if (deletingEntry && item) {
                                const original = item.config as OpenAIProviderConfig
                                const next     = {
                                    ...original,
                                    apiKeyEntries: original.apiKeyEntries.filter((_, index) => index !==
                                                                                               item.entryIndex),
                                }
                                await providersApi.patchOpenAIProvider(item.configIndex, next, original)
                            } else {
                                const ref = item?.config.entryRef
                                await deleter(identifier, baseUrl, typeof ref === 'string' ? ref : undefined)
                            }
                        } catch (error: unknown) {
                            if (generation === apiClient.getAuthGeneration()) {
                                showNotification(error instanceof Error ?
                                                 error.message :
                                                 t('notification.delete_failed'), 'error')
                            }
                            throw error
                        }
                        if (generation !== apiClient.getAuthGeneration()) {
                            return
                        }
                        try {
                            await onRefresh()
                            if (generation === apiClient.getAuthGeneration()) {
                                showNotification(t('common.success'), 'success')
                            }
                        } catch {
                            if (generation === apiClient.getAuthGeneration()) {
                                showNotification(t('common.mutation_uncertain'), 'warning')
                            }
                        }
                    },
                })
        },
        [vendorId, onRefresh, showNotification, showConfirmation, t],
    )

    const toggleApiKey = useCallback(async (authIndex: string, disabled: boolean) => {
        const generation = apiClient.getAuthGeneration()
        let updated      = false
        try {
            await authFilesApi.setStatus('', disabled, authIndex)
            updated = true
        } catch (error: unknown) {
            if (generation === apiClient.getAuthGeneration()) {
                showNotification(error instanceof Error ? error.message : t('common.error'), 'error')
            }
        }
        if (generation !== apiClient.getAuthGeneration()) {
            return
        }
        try {
            await onRefresh()
            if (updated && generation === apiClient.getAuthGeneration()) {
                showNotification(t('common.success'), 'success')
            }
        } catch (error: unknown) {
            if (generation === apiClient.getAuthGeneration()) {
                showNotification(error instanceof Error ? error.message : t('common.error'), 'error')
            }
        }
    }, [onRefresh, showNotification, t])

    const toggleAuthFile = useCallback(
        async (file: AuthFileItem, disabled: boolean) => {
            const generation = apiClient.getAuthGeneration()
            try {
                const result = await authFilesApi.setStatus(file.name, disabled, file.authIndex)
                if (generation !== apiClient.getAuthGeneration()) {
                    return
                }
                await completeMutation({
                                           kind: 'status',
                                           names: [file.name],
                                           authIndex: file.authIndex,
                                           disabled: result.disabled,
                                       })
            } catch (error: unknown) {
                if (generation === apiClient.getAuthGeneration()) {
                    showNotification(error instanceof Error ? error.message : t('common.error'), 'error')
                    await completeMutation([])
                }
            }
        },
        [completeMutation, showNotification, t],
    )

    const deleteAuthFile = useCallback(
        (name: string) => {
            const generation = apiClient.getAuthGeneration()
            showConfirmation({
                                 title: t('common.delete'),
                                 message: `${t('auth_files.delete_confirm')} "${name}"?`,
                                 variant: 'danger',
                                 confirmText: t('common.delete'),
                                 cancelText: t('common.cancel'),
                                 onConfirm: async () => {
                                     if (generation !== apiClient.getAuthGeneration()) {
                                         throw new Error(t('common.connection_changed'))
                                     }
                                     try {
                                         const result = await authFilesApi.deleteFile(name)
                                         if (generation !== apiClient.getAuthGeneration()) {
                                             return
                                         }
                                         if (result.failed.length > 0) {
                                             throw new Error(result.failed[0]?.error || t('notification.delete_failed'))
                                         }
                                         const deletedNames = result.files.length > 0 ? result.files : [name]
                                         await completeMutation({ kind: 'delete', names: deletedNames })
                                         if (generation === apiClient.getAuthGeneration()) {
                                             showNotification(t('common.success'), 'success')
                                         }
                                     } catch (error: unknown) {
                                         if (generation === apiClient.getAuthGeneration()) {
                                             showNotification(error instanceof Error ?
                                                              error.message :
                                                              t('notification.delete_failed'), 'error')
                                         }
                                         throw error
                                     }
                                 },
                             })
        },
        [completeMutation, showNotification, showConfirmation, t],
    )

    const downloadAuthFile = useCallback(
        async (name: string) => {
            const generation = apiClient.getAuthGeneration()
            const result     = await downloadAuthFilesBatch(
                [name], authFilesApi.download, undefined,
                () => generation === apiClient.getAuthGeneration(),
            )
            if (generation === apiClient.getAuthGeneration() && result.failed.length > 0) {
                showNotification(t('common.error'), 'error')
            }
        },
        [showNotification, t],
    )

    const uploadAuthFile = useCallback(
        async (file: File) => {
            const generation = apiClient.getAuthGeneration()
            try {
                const lockResult = await withAuthFileUploadLock(() => authFilesApi.upload(file))
                if (generation !== apiClient.getAuthGeneration()) {
                    return
                }
                if (!lockResult.started) {
                    showNotification(
                        t('auth_files.upload_in_progress', {
                            defaultValue: 'A credential upload is already in progress',
                        }),
                        'warning',
                    )
                    return
                }
                const result = lockResult.value
                if (result.failed.length > 0) {
                    showNotification(t('common.error'), 'error')
                    return
                }
                const uploadedNames = result.files.length > 0 ? result.files : [file.name]
                await completeMutation({ kind: 'upload', names: uploadedNames })
                if (generation === apiClient.getAuthGeneration()) {
                    showNotification(t('common.success'), 'success')
                }
            } catch (error: unknown) {
                if (generation === apiClient.getAuthGeneration()) {
                    const message = error instanceof Error ? error.message : t('common.error')
                    showNotification(message, 'error')
                }
            }
        },
        [completeMutation, showNotification, t],
    )

    return {
        deleteApiKey,
        toggleApiKey,
        toggleAuthFile,
        deleteAuthFile,
        downloadAuthFile,
        uploadAuthFile,
        uploadInFlight,
    }
}
