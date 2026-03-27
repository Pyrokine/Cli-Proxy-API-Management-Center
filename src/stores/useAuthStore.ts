/**
 * 认证状态管理
 * 从原项目 src/modules/login.js 和 src/core/connection.js 迁移
 */

import {apiClient} from '@/services/api/client'
import {secureStorage} from '@/services/storage/secureStorage'
import type {AuthState, ConnectionStatus, LoginCredentials} from '@/types'
import {detectApiBaseFromLocation, normalizeApiBase} from '@/utils/connection'
import {STORAGE_KEY_AUTH} from '@/utils/constants'
import {create} from 'zustand'
import {createJSONStorage, persist, type StateStorage} from 'zustand/middleware'
import {useConfigStore} from './useConfigStore'
import {useUsageStatsStore} from './useUsageStatsStore'

interface AuthStoreState extends AuthState {
    connectionStatus: ConnectionStatus;
    connectionError: string | null;

    // 操作
    login: (credentials: LoginCredentials) => Promise<void>;
    logout: () => void;
    checkAuth: () => Promise<boolean>;
    restoreSession: () => Promise<boolean>;
    updateServerVersion: (version: string | null, buildDate?: string | null) => void;
    updateConnectionStatus: (status: ConnectionStatus, error?: string | null) => void;
}

let restoreSessionPromise: Promise<boolean> | null = null

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
            connectionStatus: 'disconnected',
            connectionError: null,

            // 恢复会话并自动登录
            restoreSession: () => {
                if (restoreSessionPromise) {
                    return restoreSessionPromise
                }

                restoreSessionPromise = (async () => {
                    const wasLoggedIn = localStorage.getItem('isLoggedIn') === 'true'
                    const legacyBase  =
                              await secureStorage.getItem<string>('apiBase') ||
                              await secureStorage.getItem<string>('apiUrl', { encrypt: true })
                    const legacyKey   = await secureStorage.getItem<string>('managementKey')

                    const { apiBase, managementKey, rememberPassword } = get()
                    const resolvedBase                                 = normalizeApiBase(apiBase ||
                                                                                          legacyBase ||
                                                                                          detectApiBaseFromLocation())
                    const resolvedKey                                  = managementKey || legacyKey || ''
                    const resolvedRememberPassword                     = rememberPassword ||
                                                                         Boolean(managementKey) ||
                                                                         Boolean(legacyKey)

                    set({
                            apiBase: resolvedBase,
                            managementKey: resolvedKey,
                            rememberPassword: resolvedRememberPassword,
                        })
                    apiClient.setConfig({ apiBase: resolvedBase, managementKey: resolvedKey })

                    if (wasLoggedIn && resolvedBase && resolvedKey) {
                        try {
                            await get().login({
                                                  apiBase: resolvedBase,
                                                  managementKey: resolvedKey,
                                                  rememberPassword: resolvedRememberPassword,
                                              })
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
                    set({ connectionStatus: 'connecting' })

                    // 配置 API 客户端
                    apiClient.setConfig({
                                            apiBase,
                                            managementKey,
                                        })

                    // 测试连接 - 获取配置
                    await useConfigStore.getState().fetchConfig(undefined, true)

                    // 登录成功
                    set({
                            isAuthenticated: true,
                            apiBase,
                            managementKey,
                            rememberPassword,
                            connectionStatus: 'connected',
                            connectionError: null,
                        })
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
                        connectionStatus: 'disconnected',
                        connectionError: null,
                    })
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

            // 更新服务器版本
            updateServerVersion: (version, buildDate) => {
                set({ serverVersion: version || null, serverBuildDate: buildDate || null })
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
                        const raw = await secureStorage.getItem<string>(name, { encrypt: true })
                        return raw ?? null
                    },
                    setItem: async (name, value) => {
                        await secureStorage.setItem(name, value, { encrypt: true })
                    },
                    removeItem: (name) => {
                        secureStorage.removeItem(name)
                    },
                }
                return asyncStorage
            }),
            partialize: (state) => ({
                apiBase: state.apiBase,
                ...(state.rememberPassword ? { managementKey: state.managementKey } : {}),
                rememberPassword: state.rememberPassword,
                serverVersion: state.serverVersion,
                serverBuildDate: state.serverBuildDate,
            } as unknown as AuthStoreState),
        },
    ),
)

// 监听全局未授权事件
if (typeof window !== 'undefined') {
    window.addEventListener('unauthorized', () => {
        useAuthStore.getState().logout()
    })

    window.addEventListener('server-version-update', ((e: CustomEvent) => {
        const detail = e.detail || {}
        useAuthStore.getState().updateServerVersion(detail.version || null, detail.buildDate || null)
    }) as EventListener)
}
