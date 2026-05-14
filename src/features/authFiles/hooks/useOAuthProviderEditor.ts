import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack'
import { authFilesApi } from '@/services/api'
import { useAuthStore, useNotificationStore } from '@/stores'
import type { AuthFileItem, OAuthModelAliasEntry } from '@/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

export type AuthFileModelItem = {
    id: string
    display_name?: string
    type?: string
    owned_by?: string
}

type LocationState = { fromAuthFiles?: boolean } | null

const OAUTH_PROVIDER_PRESETS = [
    'gemini-cli',
    'vertex',
    'aistudio',
    'antigravity',
    'claude',
    'codex',
    'qwen',
    'kimi',
    'iflow',
]

const OAUTH_PROVIDER_EXCLUDES = new Set(['all', 'unknown', 'empty'])

export const normalizeProviderKey = (value: string) => value.trim().toLowerCase()

/**
 * 提取 API 错误中的 HTTP 状态码
 */
const extractHttpStatus = (err: unknown): unknown => {
    if (typeof err === 'object' && err !== null && 'status' in err) {
        return (err as { status?: unknown }).status
    }
    return undefined
}

type FeatureType = 'excluded' | 'modelAlias'

export function useOAuthProviderEditor(feature: FeatureType) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const location = useLocation()
    const { showNotification } = useNotificationStore()
    const connectionStatus = useAuthStore((state) => state.connectionStatus)
    const disableControls = connectionStatus !== 'connected'

    const [searchParams, setSearchParams] = useSearchParams()
    const provider = searchParams.get('provider') ?? ''
    const [files, setFiles] = useState<AuthFileItem[]>([])
    const [excluded, setExcluded] = useState<Record<string, string[]>>({})
    const [modelAlias, setModelAlias] = useState<Record<string, OAuthModelAliasEntry[]>>({})
    const [initialLoading, setInitialLoading] = useState(true)
    const [featureUnsupported, setFeatureUnsupported] = useState(false)

    const [modelsList, setModelsList] = useState<AuthFileModelItem[]>([])
    const [modelsLoading, setModelsLoading] = useState(false)
    const [modelsError, setModelsError] = useState<'unsupported' | null>(null)
    const [saving, setSaving] = useState(false)

    const providerOptions = useMemo(() => {
        const extraProviders = new Set<string>()
        Object.keys(excluded).forEach((value) => extraProviders.add(value))
        Object.keys(modelAlias).forEach((value) => extraProviders.add(value))
        files.forEach((file) => {
            if (typeof file.type === 'string') {
                extraProviders.add(file.type)
            }
            if (typeof file.provider === 'string') {
                extraProviders.add(file.provider)
            }
        })

        const normalizedExtras = Array.from(extraProviders)
            .map((value) => value.trim())
            .filter((value) => value && !OAUTH_PROVIDER_EXCLUDES.has(value.toLowerCase()))

        const baseSet = new Set(OAUTH_PROVIDER_PRESETS.map((value) => value.toLowerCase()))
        const extraList = normalizedExtras
            .filter((value) => !baseSet.has(value.toLowerCase()))
            .sort((a, b) => a.localeCompare(b))

        return [...OAUTH_PROVIDER_PRESETS, ...extraList]
    }, [excluded, files, modelAlias])

    const getTypeLabel = useCallback(
        (type: string): string => {
            const key = `auth_files.filter_${type}`
            const translated = t(key)
            if (translated !== key) {
                return translated
            }
            if (type.toLowerCase() === 'iflow') {
                return 'iFlow'
            }
            return type.charAt(0).toUpperCase() + type.slice(1)
        },
        [t]
    )

    const resolvedProviderKey = useMemo(() => normalizeProviderKey(provider), [provider])

    const handleBack = useCallback(() => {
        const state = location.state as LocationState
        if (state?.fromAuthFiles) {
            navigate(-1)
            return
        }
        navigate('/credentials', { replace: true })
    }, [location.state, navigate])

    const swipeRef = useEdgeSwipeBack({ onBack: handleBack })

    // Escape 键返回
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                handleBack()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handleBack])

    // 初始数据加载
    useEffect(() => {
        let cancelled = false

        const load = async () => {
            setInitialLoading(true)
            setFeatureUnsupported(false)
            try {
                const results = await Promise.allSettled([
                    authFilesApi.list(),
                    authFilesApi.getOauthExcludedModels(),
                    authFilesApi.getOauthModelAlias(),
                ])

                const [filesResult, excludedResult, aliasResult] = results

                if (cancelled) {
                    return
                }

                if (filesResult.status === 'fulfilled') {
                    setFiles(filesResult.value?.files ?? [])
                }

                // excluded 和 modelAlias 互为 providerOptions 的数据源，都需要设置
                // 但只需要检测当前 feature 对应的 API 是否为 404
                if (excludedResult.status === 'fulfilled') {
                    setExcluded(excludedResult.value ?? {})
                }

                if (aliasResult.status === 'fulfilled') {
                    setModelAlias(aliasResult.value ?? {})
                }

                // 检测当前 feature 的 API 是否返回 404（不支持）
                const featureResult = feature === 'excluded' ? excludedResult : aliasResult
                if (featureResult.status === 'rejected') {
                    const status = extractHttpStatus(featureResult.reason)
                    if (status === 404) {
                        setFeatureUnsupported(true)
                    }
                }
            } finally {
                if (!cancelled) {
                    setInitialLoading(false)
                }
            }
        }

        load().catch(() => {
            if (!cancelled) {
                setInitialLoading(false)
            }
        })

        return () => {
            cancelled = true
        }
    }, [feature])

    // Model 定义加载
    useEffect(() => {
        if (!resolvedProviderKey || featureUnsupported) {
            return
        }

        let cancelled = false
        queueMicrotask(() => {
            if (cancelled) {
                return
            }
            setModelsLoading(true)
            setModelsError(null)

            authFilesApi
                .getModelDefinitions(resolvedProviderKey)
                .then((models) => {
                    if (cancelled) {
                        return
                    }
                    setModelsList(models)
                })
                .catch((err: unknown) => {
                    if (cancelled) {
                        return
                    }

                    if (extractHttpStatus(err) === 404) {
                        setModelsList([])
                        setModelsError('unsupported')
                        return
                    }

                    const errorMessage = err instanceof Error ? err.message : ''
                    showNotification(`${t('notification.load_failed')}: ${errorMessage}`, 'error')
                })
                .finally(() => {
                    if (cancelled) {
                        return
                    }
                    setModelsLoading(false)
                })
        })

        return () => {
            cancelled = true
        }
    }, [featureUnsupported, resolvedProviderKey, showNotification, t])

    const updateProvider = useCallback(
        (value: string) => {
            const next = new URLSearchParams(searchParams)
            const trimmed = value.trim()
            if (trimmed) {
                next.set('provider', trimmed)
            } else {
                next.delete('provider')
            }
            setSearchParams(next, { replace: true })
        },
        [searchParams, setSearchParams]
    )

    const canSave = !disableControls && !saving && !featureUnsupported

    return {
        t,
        provider,
        resolvedProviderKey,
        providerOptions,
        getTypeLabel,
        updateProvider,
        disableControls,
        initialLoading,
        featureUnsupported,
        modelsList,
        modelsLoading,
        modelsError,
        saving,
        setSaving,
        canSave,
        handleBack,
        swipeRef,
        showNotification,
        excluded,
        modelAlias,
    }
}
