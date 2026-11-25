const ENC_V3_PREFIX    = 'enc::v3::'
const ENC_V2_PREFIX    = 'enc::v2::'
const ENC_V1_PREFIX    = 'enc::v1::'
const PLAINTEXT_PREFIX = 'plain::'
const LEGACY_PREFIXES  = [ENC_V2_PREFIX, ENC_V1_PREFIX, PLAINTEXT_PREFIX]
const KEY_DATABASE     = 'cli-proxy-api-webui-storage-keys'
const KEY_STORE        = 'keys'
const STORAGE_KEY      = 'v3'
const LEGACY_SALT      = 'cli-proxy-api-webui::secure-storage'
const PBKDF2_ITER      = 100_000
const IV_SIZE          = 12
const GCM_KEY          = { name: 'AES-GCM', length: 256 }

export class InvalidEncryptedStorageValueError extends Error {
    override name = 'InvalidEncryptedStorageValueError'
}

let cachedLegacyKey: CryptoKey | undefined

export function containsEncodedStorageValue(value: string): boolean {
    return value.includes(ENC_V3_PREFIX) || LEGACY_PREFIXES.some((prefix) => value.includes(prefix))
}

export function isEncodedStorageValue(payload: string): boolean {
    return isProtectedStorageValue(payload) || needsSecureStorageMigration(payload)
}

export function needsSecureStorageMigration(payload: string): boolean {
    const value = payload.trim()
    return LEGACY_PREFIXES.some((prefix) => value.startsWith(prefix))
}

export function isProtectedStorageValue(payload: string): boolean {
    return payload.trim().startsWith(ENC_V3_PREFIX)
}

function hasSecureWebCrypto(): boolean {
    return typeof window !== 'undefined' && window.isSecureContext &&
           typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined'
}

export function isSecureStorageEncryptionAvailable(): boolean {
    try {
        return hasSecureWebCrypto() && typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function'
    } catch {
        return false
    }
}

function openKeyDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request           = indexedDB.open(KEY_DATABASE, 1)
        let blocked             = false
        request.onupgradeneeded = () => request.result.createObjectStore(KEY_STORE)
        request.onblocked       = () => {
            blocked = true
            reject(new Error('Storage key database is blocked'))
        }
        request.onerror         = () => reject(request.error)
        request.onsuccess       = () => {
            const db = request.result
            if (blocked) {
                db.close()
                return
            }
            db.onversionchange = () => db.close()
            resolve(db)
        }
    })
}

function readOrStoreKey(db: IDBDatabase, candidate?: CryptoKey): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const transaction      = db.transaction(KEY_STORE, candidate ? 'readwrite' : 'readonly')
        const store            = transaction.objectStore(KEY_STORE)
        const request          = store.get(STORAGE_KEY)
        let key: unknown
        request.onsuccess      = () => {
            key = request.result
            if (key === undefined && candidate) {
                try {
                    store.add(candidate, STORAGE_KEY)
                    key = candidate
                } catch (error: unknown) {
                    reject(error)
                    transaction.abort()
                }
            }
        }
        transaction.onabort    = () => reject(transaction.error ?? new Error('Storage key transaction aborted'))
        transaction.oncomplete = () => resolve(key)
    })
}

async function getStorageKey(create: boolean): Promise<CryptoKey> {
    const db = await openKeyDatabase()
    try {
        let key = await readOrStoreKey(db)
        if (key === undefined && create) {
            const candidate = await crypto.subtle.generateKey(GCM_KEY, false, ['encrypt', 'decrypt'])
            // The write transaction checks again before adding the key shared by this origin
            key             = await readOrStoreKey(db, candidate)
        }
        if (!(key instanceof CryptoKey) || key.type !== 'secret' || key.extractable ||
            key.algorithm.name !== GCM_KEY.name || (key.algorithm as AesKeyAlgorithm).length !== GCM_KEY.length ||
            !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) {
            throw new Error('The browser storage key is missing or invalid')
        }
        return key
    } finally {
        db.close()
    }
}

function getKeyMaterial(): string {
    try {
        return `${LEGACY_SALT}|${window.location.host}|${navigator.userAgent}`
    } catch {
        return LEGACY_SALT
    }
}

async function deriveLegacyKey(): Promise<CryptoKey> {
    if (cachedLegacyKey) {
        return cachedLegacyKey
    }

    const enc      = new TextEncoder()
    const material = await crypto.subtle.importKey('raw', enc.encode(getKeyMaterial()), 'PBKDF2', false, ['deriveKey'])

    cachedLegacyKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(LEGACY_SALT), iterations: PBKDF2_ITER, hash: 'SHA-256' },
        material,
        GCM_KEY,
        false,
        ['decrypt'],
    )
    return cachedLegacyKey
}

function toBase64(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes  = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

// AES-256-GCM envelope: enc::v3::<base64(iv + ciphertext and tag)>
export async function encryptData(value: string): Promise<string> {
    if (!value) {
        return value
    }

    if (!isSecureStorageEncryptionAvailable()) {
        throw new Error('Encrypted storage is unavailable')
    }

    try {
        const key = await getStorageKey(true)
        const iv  = crypto.getRandomValues(new Uint8Array(IV_SIZE))
        const enc = new TextEncoder()

        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(value))

        // Prepend IV to ciphertext
        const combined = new Uint8Array(iv.length + ciphertext.byteLength)
        combined.set(iv, 0)
        combined.set(new Uint8Array(ciphertext), iv.length)

        return `${ENC_V3_PREFIX}${toBase64(combined)}`
    } catch {
        throw new Error('Storage value could not be encrypted')
    }
}

export async function decryptData(payload: string): Promise<string> {
    if (!payload) {
        return payload
    }

    if (payload.startsWith(PLAINTEXT_PREFIX)) {
        return payload.slice(PLAINTEXT_PREFIX.length)
    }

    const current = payload.startsWith(ENC_V3_PREFIX)
    if (current || payload.startsWith(ENC_V2_PREFIX)) {
        if (current ? !isSecureStorageEncryptionAvailable() : !hasSecureWebCrypto()) {
            throw new Error('Encrypted storage is unavailable')
        }

        let combined: Uint8Array
        try {
            combined = fromBase64(payload.slice((current ? ENC_V3_PREFIX : ENC_V2_PREFIX).length))
        } catch {
            throw new InvalidEncryptedStorageValueError('Encrypted storage value is malformed')
        }
        if (combined.byteLength < IV_SIZE + 16) {
            throw new InvalidEncryptedStorageValueError('Encrypted storage value is malformed')
        }

        try {
            const key       = await (current ? getStorageKey(false) : deriveLegacyKey())
            const iv        = combined.slice(0, IV_SIZE)
            const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined.slice(IV_SIZE))
            return new TextDecoder().decode(decrypted)
        } catch {
            throw new Error('Encrypted storage value could not be decrypted')
        }
    }

    // v1 兼容：XOR，由 secureStorage 读取后迁移为 v3
    if (payload.startsWith(ENC_V1_PREFIX)) {
        try {
            const enc       = new TextEncoder()
            const keyBytes  = enc.encode(getKeyMaterial())
            const encrypted = fromBase64(payload.slice(ENC_V1_PREFIX.length))
            const result    = new Uint8Array(encrypted.length)
            for (let i = 0; i < encrypted.length; i++) {
                result[i] = encrypted[i] ^ keyBytes[i % keyBytes.length]
            }
            return new TextDecoder().decode(result)
        } catch {
            throw new Error('Encrypted storage value could not be decrypted')
        }
    }

    throw new Error('Storage value is not encoded')
}
