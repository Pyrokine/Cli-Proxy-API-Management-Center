/**
 * 认证状态管理
 * 从原项目 src/modules/login.js 和 src/core/connection.js 迁移
 */

import {apiClient} from '@/services/api/client'
import {type ServerFeatureFlags, versionApi} from '@/services/api/version'
import {secureStorage} from '@/services/storage/secureStorage'
import type {AuthState, ConnectionStatus, LoginCredentials} from '@/types'
import {detectApiBaseFromLocation, normalizeApiBase, resolveApiBase} from '@/utils/connection'
import {STORAGE_KEY_AUTH} from '@/utils/constants'
import {isEncodedStorageValue} from '@/utils/encryption'
import {create} from 'zustand'
import {createJSONStorage, persist, type StateStorage} from 'zustand/middleware'
import {useConfigStore} from './useConfigStore'
import {useUsageStatsStore} from './useUsageStatsStore'

interface AuthStoreState extends AuthState {
    connectionStatus: ConnectionStatus
    connectionError: string | null
    hydrated: boolean
    serverVersionSource: 'header' | 'version' | null
    storageRestoreFailed: boolean

    // 操作
    login: (credentials: LoginCredentials) => Promise<void>
    logout: () => void
    checkAuth: () => Promise<boolean>
    restoreSession: () => Promise<boolean>
    refreshServerVersion: () => Promise<void>
    updateServerVersion: (
        version: string | null,
        buildDate?: string | null,
        source?: 'header' | 'version',
        minPanelVersion?: string | null,
        features?: ServerFeatureFlags,
    ) => void
    updateConnectionStatus: (status: ConnectionStatus, error?: string | null) => void
}

let restoreSessionPromise: Promise<boolean> | null    = null
let refreshServerVersionPromise: Promise<void> | null = null
let persistedAuthRestoreFailed                        = false

function markPersistedAuthRestoreFailed(): void {
    persistedAuthRestoreFailed = true
}

export const useAuthStore = create<AuthStoreState>()(
    persist(
        (set, get) => ({
            // 初始状态
            isAuthenticated: false,
            apiBase: '',
            managementKey: '',
            rememberPassword: false,
            serverVersion: null,
            serverBuildDate: null,
            serverMinPanelVersion: null,
            serverFeatures: {},
            serverVersionSource: null,
            storageRestoreFailed: false,
            connectionStatus: 'disconnected',
            connectionError: null,
            hydrated: false,

            // 恢复会话并自动登录
            restoreSession: () => {
                if (restoreSessionPromise) {
                    return restoreSessionPromise
                }

                restoreSessionPromise = (async () => {
                    await waitForAuthHydration()

                    const wasLoggedIn              = localStorage.getItem('isLoggedIn') === 'true'
                    let storageRestoreFailed       = persistedAuthRestoreFailed
                    const markStorageRestoreFailed = () => {
                        storageRestoreFailed = true
                    }
                    const legacyBase               =
                              (await secureStorage.getItem<string>('apiBase', {
                                  onInvalidEncryptedValue: markStorageRestoreFailed,
                              })) ||
                              (await secureStorage.getItem<string>('apiUrl', {
                                  encrypt: true,
                                  onInvalidEncryptedValue: markStorageRestoreFailed,
                              }))
                    const legacyKey                = await secureStorage.getItem<string>('managementKey', {
                        onInvalidEncryptedValue: markStorageRestoreFailed,
                    })

                    const { apiBase, managementKey, rememberPassword } = get()
                    const resolvedBase                                 = resolveApiBase(
                        apiBase,
                        legacyBase,
                        detectApiBaseFromLocation(),
                    )
                    const resolvedKey                                  = [managementKey, legacyKey].find(
                        (key) => key && !isEncodedStorageValue(key),
                    ) || ''
                    const resolvedRememberPassword                     = rememberPassword || wasLoggedIn

                    set({
                            apiBase: resolvedBase,
                            managementKey: resolvedKey,
                            rememberPassword: resolvedRememberPassword,
                            storageRestoreFailed,
                        })
                    apiClient.setConfig({ apiBase: resolvedBase, managementKey: resolvedKey })

                    if (resolvedBase && resolvedKey && (wasLoggedIn || Boolean(managementKey) || Boolean(legacyKey))) {
                        try {
                            await get().login({
                                                  apiBase: resolvedBase,
                                                  managementKey: resolvedKey,
                                                  rememberPassword: resolvedRememberPassword,
                                              })
                            if (storageRestoreFailed) {
                                set({ storageRestoreFailed: true })
                            }
                            return true
                        } catch (error) {
                            console.warn('Auto login failed:', error)
                            return false
                        }
                    }

                    return false
                })()

                return restoreSessionPromise
            },

            // 登录
            login: async (credentials) => {
                const apiBase          = normalizeApiBase(credentials.apiBase)
                const managementKey    = credentials.managementKey.trim()
                const rememberPassword = credentials.rememberPassword ?? get().rememberPassword ?? false

                try {
                    set({
                            connectionStatus: 'connecting',
                            serverVersion: null,
                            serverBuildDate: null,
                            serverMinPanelVersion: null,
                            serverFeatures: {},
                            serverVersionSource: null,
                        })

                    // 配置 API 客户端
                    apiClient.setConfig({
                                            apiBase,
                                            managementKey,
                                        })

                    // 测试连接 - 获取配置
                    await useConfigStore.getState().fetchConfig(undefined, true)
                    await get()
                        .refreshServerVersion()
                        .catch((error) => {
                            console.warn('Fetch server version failed:', error)
                        })

                    // 登录成功
                    set({
                            isAuthenticated: true,
                            apiBase,
                            managementKey,
                            rememberPassword,
                            connectionStatus: 'connected',
                            connectionError: null,
                            storageRestoreFailed: false,
                        })
                    persistedAuthRestoreFailed = false
                    await Promise.all([
                                          secureStorage.setItem(
                                              'apiBase',
                                              apiBase,
                                              { encrypt: true, persistent: rememberPassword },
                                          ),
                                          secureStorage.setItem('managementKey', managementKey, {
                                              encrypt: true,
                                              persistent: rememberPassword,
                                          }),
                                      ])
                    if (rememberPassword) {
                        localStorage.setItem('isLoggedIn', 'true')
                    } else {
                        localStorage.removeItem('isLoggedIn')
                    }
                } catch (error: unknown) {
                    const message =
                              error instanceof Error ?
                              error.message :
                              typeof error === 'string' ? error : 'Connection failed'
                    set({
                            isAuthenticated: false,
                            connectionStatus: 'error',
                            connectionError: message || 'Connection failed',
                        })
                    throw error
                }
            },

            // 登出
            logout: () => {
                restoreSessionPromise = null
                useConfigStore.getState().clearCache()
                useUsageStatsStore.getState().clearUsageStats()
                set({
                        isAuthenticated: false,
                        apiBase: '',
                        managementKey: '',
                        serverVersion: null,
                        serverBuildDate: null,
                        serverMinPanelVersion: null,
                        serverFeatures: {},
                        serverVersionSource: null,
                        connectionStatus: 'disconnected',
                        connectionError: null,
                        storageRestoreFailed: false,
                        hydrated: true,
                    })
                persistedAuthRestoreFailed = false
                secureStorage.removeItem('apiBase', { persistent: true })
                secureStorage.removeItem('apiBase', { persistent: false })
                secureStorage.removeItem('apiUrl', { persistent: true })
                secureStorage.removeItem('apiUrl', { persistent: false })
                secureStorage.removeItem('managementKey', { persistent: true })
                secureStorage.removeItem('managementKey', { persistent: false })
                localStorage.removeItem('isLoggedIn')
            },

            // 检查认证状态
            checkAuth: async () => {
                const { managementKey, apiBase } = get()

                if (!managementKey || !apiBase) {
                    return false
                }

                try {
                    // 重新配置客户端
                    apiClient.setConfig({ apiBase, managementKey })

                    // 验证连接
                    await useConfigStore.getState().fetchConfig()

                    await get()
                        .refreshServerVersion()
                        .catch((error) => {
                            console.warn('Fetch server version failed:', error)
                        })

                    set({
                            isAuthenticated: true,
                            connectionStatus: 'connected',
                        })

                    return true
                } catch {
                    set({
                            isAuthenticated: false,
                            connectionStatus: 'error',
                        })
                    return false
                }
            },

            refreshServerVersion: async () => {
                if (refreshServerVersionPromise) {
                    return refreshServerVersionPromise
                }

                refreshServerVersionPromise = versionApi
                    .get()
                    .then((info) => {
                        get().updateServerVersion(
                            info?.version || null,
                            info?.build_time || null,
                            'version',
                            info?.min_panel_version || null,
                            info?.features ?? {},
                        )
                    })
                    .catch((error: unknown) => {
                        if (error instanceof Error && /404/.test(error.message)) {
                            return
                        }
                        throw error
                    })
                    .finally(() => {
                        refreshServerVersionPromise = null
                    })

                return refreshServerVersionPromise
            },

            // 更新服务器版本
            updateServerVersion: (version, buildDate, source = 'header', minPanelVersion = null, features = {}) => {
                const currentSource = get().serverVersionSource
                if (source === 'header' && currentSource === 'version') {
                    return
                }
                set((state) => ({
                    serverVersion: version || null,
                    serverBuildDate: buildDate || null,
                    serverMinPanelVersion: source === 'version' ? minPanelVersion || null : state.serverMinPanelVersion,
                    serverFeatures: source === 'version' ? features : state.serverFeatures,
                    serverVersionSource: version || buildDate ? source : null,
                }))
            },

            // 更新连接状态
            updateConnectionStatus: (status, error = null) => {
                set({
                        connectionStatus: status,
                        connectionError: error,
                    })
            },
        }),
        {
            name: STORAGE_KEY_AUTH,
            storage: createJSONStorage<AuthStoreState>(() => {
                const asyncStorage: StateStorage = {
                    getItem: async (name) => {
                        const persistentRaw = await secureStorage.getItem<string>(name, {
                            encrypt: true,
                            persistent: true,
                            onInvalidEncryptedValue: markPersistedAuthRestoreFailed,
                        })
                        if (persistentRaw !== null) {
                            return persistentRaw
                        }
                        const sessionRaw = await secureStorage.getItem<string>(name, {
                            encrypt: true,
                            persistent: false,
                            onInvalidEncryptedValue: markPersistedAuthRestoreFailed,
                        })
                        return sessionRaw ?? null
                    },
                    setItem: async (name, value) => {
                        let persistent: boolean
                        try {
                            const parsed = JSON.parse(value) as { state?: { rememberPassword?: boolean } }
                            persistent   = Boolean(parsed.state?.rememberPassword)
                        } catch {
                            persistent = false
                        }
                        await secureStorage.setItem(name, value, { encrypt: true, persistent })
                        if (persistent) {
                            sessionStorage.removeItem(name)
                        } else {
                            localStorage.removeItem(name)
                        }
                    },
                    removeItem: (name) => {
                        sessionStorage.removeItem(name)
                        localStorage.removeItem(name)
                    },
                }
                return asyncStorage
            }),
            partialize: (state) =>
                ({
                    apiBase: state.apiBase,
                    managementKey: state.managementKey,
                    rememberPassword: state.rememberPassword,
                    serverVersion: state.serverVersion,
                    serverBuildDate: state.serverBuildDate,
                    serverMinPanelVersion: state.serverMinPanelVersion,
                    serverVersionSource: state.serverVersionSource,
                }) as unknown as AuthStoreState,
            onRehydrateStorage: () => () => {
                useAuthStore.setState({ hydrated: true })
            },
        },
    ),
)

function waitForAuthHydration(): Promise<void> {
    if (useAuthStore.persist.hasHydrated()) {
        return Promise.resolve()
    }
    return new Promise((resolve) => {
        const unsubscribe = useAuthStore.persist.onFinishHydration(() => {
            unsubscribe()
            resolve()
        })
    })
}

// 监听全局未授权事件 — 仅标记连接状态，不触发 logout 以避免级联请求
if (typeof window !== 'undefined') {
    window.addEventListener('unauthorized', () => {
        const state = useAuthStore.getState()
        if (state.isAuthenticated) {
            state.updateConnectionStatus('error', 'Management key is invalid or expired')
            useAuthStore.setState({ isAuthenticated: false, hydrated: true })
        }
    })

    window.addEventListener('server-version-update', ((e: CustomEvent) => {
        const detail = e.detail || {}
        useAuthStore.getState().updateServerVersion(detail.version || null, detail.buildDate || null, 'header')
    }) as EventListener)
}
