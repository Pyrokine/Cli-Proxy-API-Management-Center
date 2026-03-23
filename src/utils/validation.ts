/**
 * 验证工具函数
 */

/**
 * 验证 API Key 格式（≥8 字符，仅 ASCII 可打印字符 0x21-0x7E）
 */
export function isValidApiKey(key: string): boolean {
    if (!key || key.length < 8) {
        return false
    }
    return /^[\x21-\x7E]+$/.test(key)
}
