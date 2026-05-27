import {authFilesApi} from '@/services/api/authFiles'
import {providersApi} from '@/services/api/providers'
import {useNotificationStore} from '@/stores'
import {useCallback} from 'react'
import {useTranslation} from 'react-i18next'

type ApiKeyDeleter = (identifier: string, baseUrl?: string) => Promise<unknown>

const API_KEY_DELETERS: Record<string, ApiKeyDeleter> = {
    gemini: (key, baseUrl) => providersApi.deleteGeminiKey(key, baseUrl),
    claude: (key, baseUrl) => providersApi.deleteClaudeConfig(key, baseUrl),
    codex: (key, baseUrl) => providersApi.deleteCodexConfig(key, baseUrl),
    vertex: (key, baseUrl) => providersApi.deleteVertexConfig(key, baseUrl),
    openai: (name) => providersApi.deleteOpenAIProvider(name),
}

const DELETE_CONFIRM_KEYS: Record<string, string> = {
    gemini: 'ai_providers.gemini_delete_confirm',
    claude: 'ai_providers.claude_delete_confirm',
    codex: 'ai_providers.codex_delete_confirm',
    vertex: 'ai_providers.vertex_delete_confirm',
    openai: 'ai_providers.openai_delete_confirm',
}

export function useVendorActions(vendorId: string, onRefresh: () => Promise<void>) {
    const { t }            = useTranslation()
    const showNotification = useNotificationStore((s) => s.showNotification)
    const showConfirmation = useNotificationStore((s) => s.showConfirmation)

    const deleteApiKey = useCallback(
        (identifier: string, baseUrl?: string) => {
            const deleter = API_KEY_DELETERS[vendorId]
            if (!deleter) {
                return
            }
            const confirmKey = DELETE_CONFIRM_KEYS[vendorId] ?? 'api_keys.delete_confirm'
            showConfirmation({
                                 title: t('common.delete'),
                                 message: t(confirmKey),
                                 variant: 'danger',
                                 confirmText: t('common.delete'),
                                 cancelText: t('common.cancel'),
                                 onConfirm: async () => {
                                     await deleter(identifier, baseUrl)
                                     showNotification(t('common.success'), 'success')
                                     await onRefresh()
                                 },
                             })
        },
        [vendorId, onRefresh, showNotification, showConfirmation, t],
    )

    const toggleAuthFile = useCallback(
        async (name: string, disabled: boolean) => {
            try {
                await authFilesApi.setStatus(name, disabled)
                await onRefresh()
            } catch {
                showNotification(t('common.error'), 'error')
            }
        },
        [onRefresh, showNotification, t],
    )

    const deleteAuthFile = useCallback(
        (name: string) => {
            showConfirmation({
                                 title: t('common.delete'),
                                 message: `${t('auth_files.delete_confirm')} "${name}"?`,
                                 variant: 'danger',
                                 confirmText: t('common.delete'),
                                 cancelText: t('common.cancel'),
                                 onConfirm: async () => {
                                     const result = await authFilesApi.deleteFile(name)
                                     if (result.failed.length > 0) {
                                         throw new Error(result.failed[0]?.error || t('common.error'))
                                     }
                                     showNotification(t('common.success'), 'success')
                                     await onRefresh()
                                 },
                             })
        },
        [onRefresh, showNotification, showConfirmation, t],
    )

    const downloadAuthFile = useCallback(
        async (name: string) => {
            try {
                const content = await authFilesApi.downloadText(name)
                const blob    = new Blob([content], { type: 'text/plain' })
                const url     = URL.createObjectURL(blob)
                const a       = document.createElement('a')
                a.href        = url
                a.download    = name
                a.click()
                URL.revokeObjectURL(url)
            } catch {
                showNotification(t('common.error'), 'error')
            }
        },
        [showNotification, t],
    )

    const uploadAuthFile = useCallback(
        async (file: File) => {
            try {
                const result = await authFilesApi.upload(file)
                if (result.failed.length > 0) {
                    showNotification(t('common.error'), 'error')
                    return
                }
                showNotification(t('common.success'), 'success')
                await onRefresh()
            } catch {
                showNotification(t('common.error'), 'error')
            }
        },
        [onRefresh, showNotification, t],
    )

    return { deleteApiKey, toggleAuthFile, deleteAuthFile, downloadAuthFile, uploadAuthFile }
}
