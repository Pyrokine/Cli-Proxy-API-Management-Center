/**
 * 安全存储服务
 * 使用 AES-256-GCM 加密敏感数据，存储到 sessionStorage（关闭 tab 自动清除）
 */

import {decryptData, encryptData, isSecureStorageEncryptionAvailable} from '@/utils/encryption'

interface StorageOptions {
    encrypt?: boolean
    persistent?: boolean // true = localStorage (非敏感数据), false = sessionStorage (默认)
}

class SecureStorageService {
    /**
     * 存储数据
     */
    async setItem(key: string, value: unknown, options: StorageOptions = {}): Promise<void> {
        const { encrypt = true, persistent = false } = options

        if (value === null || value === undefined) {
            this.removeItem(key, options)
            return
        }

        const stringValue = JSON.stringify(value)
        const storedValue = encrypt ? await encryptData(stringValue) : stringValue

        if (!storedValue) {
            this.removeItem(key, options)
            return
        }

        this.storage(persistent).setItem(key, storedValue)
    }

    /**
     * 获取数据
     */
    async getItem<T = unknown>(key: string, options: StorageOptions = {}): Promise<T | null> {
        const { encrypt = true, persistent = false } = options

        // Check both storages for migration compatibility
        const store = this.storage(persistent)
        let raw     = store.getItem(key)

        // Fallback: check localStorage if sessionStorage is empty (migration from old version)
        if (raw === null && !persistent) {
            raw = localStorage.getItem(key)
            if (raw !== null) {
                // Migrate to sessionStorage and remove from localStorage
                store.setItem(key, raw)
                localStorage.removeItem(key)
            }
        }

        if (raw === null) {
            return null
        }

        try {
            const decrypted = encrypt ? await decryptData(raw) : raw
            return JSON.parse(decrypted) as T
        } catch {
            try {
                if (encrypt && (raw.startsWith('enc::v2::') || raw.startsWith('enc::v1::'))) {
                    const decrypted = await decryptData(raw)
                    return decrypted as T
                }
                return raw as T
            } catch {
                return null
            }
        }
    }

    /**
     * 删除数据
     */
    removeItem(key: string, options: StorageOptions = {}): void {
        const { persistent = false } = options
        this.storage(persistent).removeItem(key)
        // Also clean from the other storage during migration period
        if (!persistent) {
            localStorage.removeItem(key)
        }
    }

    private storage(persistent: boolean): Storage {
        return persistent ? localStorage : sessionStorage
    }
}

export const secureStorage = new SecureStorageService()

export function isSecureStorageProtected(): boolean {
    return isSecureStorageEncryptionAvailable()
}
