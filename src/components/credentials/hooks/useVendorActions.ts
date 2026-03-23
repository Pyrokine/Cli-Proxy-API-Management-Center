import {authFilesApi} from '@/services/api/authFiles'
import {providersApi} from '@/services/api/providers'
import {useNotificationStore} from '@/stores'
import {useCallback} from 'react'
import {useTranslation} from 'react-i18next'

type ApiKeyDeleter = (identifier: string) => Promise<unknown>;

const API_KEY_DELETERS: Record<string, ApiKeyDeleter> = {
    gemini: (key) => providersApi.deleteGeminiKey(key),
    claude: (key) => providersApi.deleteClaudeConfig(key),
    codex: (key) => providersApi.deleteCodexConfig(key),
    vertex: (key) => providersApi.deleteVertexConfig(key),
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
        (identifier: string) => {
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
                                     await deleter(identifier)
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
                                     await authFilesApi.deleteFile(name)
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
                await authFilesApi.upload(file)
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
