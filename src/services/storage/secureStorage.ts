/**
 * 安全存储服务
 * 使用 AES-256-GCM 加密敏感数据，加密不可用时不写入浏览器存储
 */

import {
    decryptData,
    encryptData,
    InvalidEncryptedStorageValueError,
    isEncodedStorageValue,
    isProtectedStorageValue,
    isSecureStorageEncryptionAvailable,
    needsSecureStorageMigration,
} from '@/utils/encryption'

type SecureStorageReadResult<T> =
    | { status: 'value'; value: T }
    | { status: 'absent' | 'unreadable' | 'invalid' | 'cancelled'; value: null }

type SecureStorageWriteResult = 'stored' | 'removed' | 'memory-only' | 'cancelled'

const INVALIDATED_STORAGE_VALUE = 'invalidated::'

interface StorageOptions {
    encrypt?: boolean
    persistent?: boolean // true = localStorage，false = sessionStorage（默认）
    fallbackToPersistent?: boolean
    clearAlternate?: boolean
    onInvalidEncryptedValue?: () => void
    onUnreadableValue?: () => void
    shouldCommit?: () => boolean
    validate?: (value: unknown) => boolean
}

class SecureStorageService {
    /**
     * 存储数据
     */
    async setItem(key: string, value: unknown, options: StorageOptions = {}): Promise<SecureStorageWriteResult> {
        const { encrypt = true, persistent = false } = options

        if (value === null || value === undefined) {
            return this.removeItem(key, options) ? 'removed' : 'memory-only'
        }

        try {
            const stringValue = JSON.stringify(value)
            if (!stringValue) {
                return this.removeItem(key, options) ? 'removed' : 'memory-only'
            }
            const storedValue = encrypt ? await encryptData(stringValue) : stringValue
            if (!this.canCommit(options)) {
                return 'cancelled'
            }
            const target = this.storage(persistent)
            target.setItem(key, storedValue)
            if (options.clearAlternate && !this.clearStorageValue(this.storage(!persistent), key)) {
                this.clearStorageValue(target, key)
                return 'memory-only'
            }
            return 'stored'
        } catch {
            if (!this.canCommit(options)) {
                return 'cancelled'
            }
            if (encrypt) {
                this.removeUnprotectedEverywhere(key)
            }
            return 'memory-only'
        }
    }

    /**
     * 获取数据
     */
    async getItem<T = unknown>(key: string, options: StorageOptions = {}): Promise<T | null> {
        const result = await this.getItemResult<T>(key, options)
        if (result.status === 'unreadable') {
            if (options.onUnreadableValue) {
                options.onUnreadableValue()
            } else {
                options.onInvalidEncryptedValue?.()
            }
        } else if (result.status === 'invalid') {
            options.onInvalidEncryptedValue?.()
        }
        return result.value
    }

    async getItemResult<T = unknown>(
        key: string,
        options: StorageOptions = {},
    ): Promise<SecureStorageReadResult<T>> {
        const {
                  encrypt              = true,
                  persistent           = false,
                  fallbackToPersistent = true,
              } = options

        let target: Storage
        let source: Storage
        let raw: string | null
        try {
            target = this.storage(persistent)
            source = target
            raw    = target.getItem(key)
            if (raw === null && !persistent && fallbackToPersistent) {
                source = localStorage
                raw    = source.getItem(key)
            }
        } catch {
            return { status: 'unreadable', value: null }
        }

        if (!this.canCommit(options)) {
            return { status: 'cancelled', value: null }
        }
        if (raw === null) {
            return { status: 'absent', value: null }
        }
        if (encrypt && !isEncodedStorageValue(raw)) {
            this.removeStoredValue(source, key, raw)
            return { status: 'invalid', value: null }
        }

        const requiresMigration = encrypt && needsSecureStorageMigration(raw)
        let decoded: string
        try {
            decoded = encrypt ? await decryptData(raw) : raw
        } catch (error: unknown) {
            if (!this.canCommit(options)) {
                return { status: 'cancelled', value: null }
            }
            if (error instanceof InvalidEncryptedStorageValueError) {
                this.removeStoredValue(source, key, raw)
                return { status: 'invalid', value: null }
            }
            if (requiresMigration) {
                this.removeUnprotectedEverywhere(key)
                return { status: 'invalid', value: null }
            }
            return { status: 'unreadable', value: null }
        }

        if (!this.canCommit(options)) {
            return { status: 'cancelled', value: null }
        }

        let value: T
        try {
            value = JSON.parse(decoded) as T
        } catch {
            if (encrypt) {
                this.removeStoredValue(source, key, raw)
                return { status: 'invalid', value: null }
            }
            value = decoded as T
        }
        if (options.validate && !options.validate(value)) {
            this.removeStoredValue(source, key, raw)
            return { status: 'invalid', value: null }
        }

        let protectedValue = raw
        if (requiresMigration) {
            try {
                protectedValue = await encryptData(decoded)
            } catch {
                if (!this.canCommit(options)) {
                    return { status: 'cancelled', value: null }
                }
                this.removeUnprotectedEverywhere(key)
                return { status: 'invalid', value: null }
            }
        }

        if (!this.canCommit(options)) {
            return { status: 'cancelled', value: null }
        }
        if (source !== target || protectedValue !== raw) {
            try {
                target.setItem(key, protectedValue)
                if (source !== target && !this.clearStorageValue(source, key) && requiresMigration) {
                    this.clearStorageValue(target, key)
                    this.removeUnprotectedEverywhere(key)
                    return { status: 'invalid', value: null }
                }
            } catch {
                if (!this.canCommit(options)) {
                    return { status: 'cancelled', value: null }
                }
                if (requiresMigration) {
                    this.removeUnprotectedEverywhere(key)
                    return { status: 'invalid', value: null }
                }
                return { status: 'unreadable', value: null }
            }
        }

        return { status: 'value', value }
    }

    /**
     * 删除数据
     */
    removeItem(key: string, options: StorageOptions = {}): boolean {
        const { persistent = false } = options
        const clearAlternate         = options.clearAlternate ?? !persistent
        let removed                  = this.clearStorageKey(persistent, key)
        if (clearAlternate) {
            removed = this.clearStorageKey(!persistent, key) && removed
        }
        return removed
    }

    private canCommit(options: StorageOptions): boolean {
        try {
            return options.shouldCommit?.() ?? true
        } catch {
            return false
        }
    }

    private clearStorageKey(persistent: boolean, key: string): boolean {
        try {
            return this.clearStorageValue(this.storage(persistent), key)
        } catch {
            return false
        }
    }

    private clearStorageValue(storage: Storage, key: string): boolean {
        try {
            storage.removeItem(key)
            return true
        } catch {
            try {
                storage.setItem(key, INVALIDATED_STORAGE_VALUE)
                return true
            } catch {
                return false
            }
        }
    }

    private removeStoredValue(storage: Storage, key: string, expected: string): void {
        try {
            if (storage.getItem(key) !== expected) {
                return
            }
        } catch {
            return
        }
        this.clearStorageValue(storage, key)
    }

    private removeUnprotectedEverywhere(key: string): void {
        for (const persistent of [false, true]) {
            try {
                const storage = this.storage(persistent)
                const value   = storage.getItem(key)
                if (value !== null && !isProtectedStorageValue(value)) {
                    this.clearStorageValue(storage, key)
                }
            } catch {
                // 当前存储不可访问时不改动现有值
            }
        }
    }

    private storage(persistent: boolean): Storage {
        return persistent ? localStorage : sessionStorage
    }
}

export const secureStorage = new SecureStorageService()

export function isSecureStorageProtected(): boolean {
    return isSecureStorageEncryptionAvailable() &&
           typeof navigator !== 'undefined' &&
           typeof navigator.locks?.request === 'function'
}
