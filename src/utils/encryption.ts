/**
 * 加密工具 — AES-GCM via Web Crypto API
 *
 * 密钥通过 PBKDF2 从 (salt + host + userAgent) 派生。
 * 同源脚本仍可重建密钥（浏览器 localStorage 的固有限制），
 * 但 AES-GCM 比 XOR 提供了真正的密码学保护：
 *   - 每次加密使用随机 IV，相同明文产生不同密文
 *   - 认证加密（AEAD），篡改可检测
 *   - 密钥不以明文形式存在于内存中（CryptoKey 对象不可导出）
 */

const ENC_V2_PREFIX = 'enc::v2::'
const ENC_V1_PREFIX = 'enc::v1::'
const SECRET_SALT   = 'cli-proxy-api-webui::secure-storage'
const PBKDF2_ITER   = 100_000

let cachedKey: CryptoKey | null = null

function getKeyMaterial(): string {
    try {
        return `${SECRET_SALT}|${window.location.host}|${navigator.userAgent}`
    } catch {
        return SECRET_SALT
    }
}

async function deriveKey(): Promise<CryptoKey> {
    if (cachedKey) {
        return cachedKey
    }

    const enc      = new TextEncoder()
    const material = await crypto.subtle.importKey(
        'raw', enc.encode(getKeyMaterial()), 'PBKDF2', false, ['deriveKey'],
    )

    cachedKey = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(SECRET_SALT), iterations: PBKDF2_ITER, hash: 'SHA-256' },
        material,
        { name: 'AES-GCM', length: 256 },
        false,  // non-extractable
        ['encrypt', 'decrypt'],
    )
    return cachedKey
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

/**
 * 加密数据 (AES-256-GCM)
 * 格式: enc::v2::<base64(iv + ciphertext)>
 */
export async function encryptData(value: string): Promise<string> {
    if (!value) {
        return value
    }

    try {
        const key = await deriveKey()
        const iv  = crypto.getRandomValues(new Uint8Array(12))
        const enc = new TextEncoder()

        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            enc.encode(value),
        )

        // Prepend IV to ciphertext
        const combined = new Uint8Array(iv.length + ciphertext.byteLength)
        combined.set(iv, 0)
        combined.set(new Uint8Array(ciphertext), iv.length)

        return `${ENC_V2_PREFIX}${toBase64(combined)}`
    } catch {
        // Web Crypto not available (e.g., non-secure context) — refuse to store plaintext
        console.warn('Web Crypto unavailable, encryption skipped. Ensure HTTPS or localhost.')
        return ''
    }
}

/**
 * 解密数据 (AES-256-GCM，兼容 v1 XOR 格式)
 */
export async function decryptData(payload: string): Promise<string> {
    if (!payload) {
        return payload
    }

    // v2: AES-GCM
    if (payload.startsWith(ENC_V2_PREFIX)) {
        try {
            const key      = await deriveKey()
            const combined = fromBase64(payload.slice(ENC_V2_PREFIX.length))
            const iv       = combined.slice(0, 12)
            const data     = combined.slice(12)

            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                key,
                data,
            )
            return new TextDecoder().decode(decrypted)
        } catch {
            return payload
        }
    }

    // v1 兼容: XOR (读取旧数据后会在下次写入时升级为 v2)
    if (payload.startsWith(ENC_V1_PREFIX)) {
        try {
            const enc      = new TextEncoder()
            const keyBytes = enc.encode(getKeyMaterial())
            const encrypted = fromBase64(payload.slice(ENC_V1_PREFIX.length))
            const result    = new Uint8Array(encrypted.length)
            for (let i = 0; i < encrypted.length; i++) {
                result[i] = encrypted[i] ^ keyBytes[i % keyBytes.length]
            }
            return new TextDecoder().decode(result)
        } catch {
            return payload
        }
    }

    return payload
}
