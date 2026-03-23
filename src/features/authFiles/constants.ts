import type {AuthFileItem} from '@/types'
import {formatDateTime} from '@/utils/format'
import {type KeyStatBucket, type KeyStats, normalizeAuthIndex, normalizeUsageSourceId} from '@/utils/usage'

export function resolveAuthFileStats(file: AuthFileItem, stats: KeyStats): KeyStatBucket {
    const defaultStats: KeyStatBucket = { success: 0, failure: 0 }
    const rawFileName                 = file?.name || ''

    // 兼容 auth_index 和 authIndex 两种字段名（API 返回的是 auth_index）
    const rawAuthIndex = file['auth_index'] ?? file.authIndex
    const authIndexKey = normalizeAuthIndex(rawAuthIndex)

    // 尝试根据 authIndex 匹配
    if (authIndexKey && stats.byAuthIndex?.[authIndexKey]) {
        return stats.byAuthIndex[authIndexKey]
    }

    // 尝试根据 source (文件名) 匹配
    const fileNameId = rawFileName ? normalizeUsageSourceId(rawFileName) : ''
    if (fileNameId && stats.bySource?.[fileNameId]) {
        const fromName = stats.bySource[fileNameId]
        if (fromName.success > 0 || fromName.failure > 0) {
            return fromName
        }
    }

    // 尝试去掉扩展名后匹配
    if (rawFileName) {
        const nameWithoutExt = rawFileName.replace(/\.[^/.]+$/, '')
        if (nameWithoutExt && nameWithoutExt !== rawFileName) {
            const nameWithoutExtId   = normalizeUsageSourceId(nameWithoutExt)
            const fromNameWithoutExt = nameWithoutExtId ? stats.bySource?.[nameWithoutExtId] : undefined
            if (fromNameWithoutExt && (fromNameWithoutExt.success > 0 || fromNameWithoutExt.failure > 0)) {
                return fromNameWithoutExt
            }
        }
    }

    return defaultStats
}

export const formatModified = (item: AuthFileItem): string => {
    const raw = item['modtime'] ?? item.modified
    if (!raw) {
        return '-'
    }
    const asNumber = Number(raw)
    const date     =
              Number.isFinite(asNumber) && !Number.isNaN(asNumber)
              ? new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber)
              : new Date(String(raw))
    return Number.isNaN(date.getTime()) ? '-' : formatDateTime(date)
}
