/**
 * 辅助工具函数
 * 从原项目 src/utils/array.js, dom.js, html.js 迁移
 */

/**
 * 生成唯一 ID
 */
export function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Parse a route parameter string to a valid integer index, or null if invalid.
 */
export const parseIndexParam = (value: string | undefined): number | null => {
    if (!value) {
        return null
    }
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : null
}

/**
 * Extract a human-readable message from an unknown error value.
 */
export const getErrorMessage = (err: unknown): string => {
    if (err instanceof Error) {
        return err.message
    }
    if (typeof err === 'string') {
        return err
    }
    return ''
}
