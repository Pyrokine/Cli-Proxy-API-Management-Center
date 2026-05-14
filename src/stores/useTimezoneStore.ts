/**
 * 时区状态管理
 * 支持用户选择时区，影响全局日期时间显示
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const STORAGE_KEY = 'cli-proxy-timezone'

/** 空字符串表示跟随浏览器本地时区 */
type TimezoneValue = string

interface TimezoneState {
    timezone: TimezoneValue
    setTimezone: (tz: TimezoneValue) => void
}

/**
 * 常用时区列表（覆盖主要开发者分布区域）
 * label 使用 UTC 偏移 + 城市名，便于快速识别
 */
export const TIMEZONE_OPTIONS: readonly { value: string; label: string }[] = [
    { value: '', label: 'system_timezone' },
    { value: 'UTC', label: 'UTC' },
    { value: 'America/Los_Angeles', label: 'UTC-8 Los Angeles' },
    { value: 'America/New_York', label: 'UTC-5 New York' },
    { value: 'Europe/London', label: 'UTC+0 London' },
    { value: 'Europe/Moscow', label: 'UTC+3 Moscow' },
    { value: 'Asia/Dubai', label: 'UTC+4 Dubai' },
    { value: 'Asia/Kolkata', label: 'UTC+5:30 Kolkata' },
    { value: 'Asia/Shanghai', label: 'UTC+8 Shanghai' },
    { value: 'Asia/Tokyo', label: 'UTC+9 Tokyo' },
    { value: 'Australia/Sydney', label: 'UTC+11 Sydney' },
] as const

export const useTimezoneStore = create<TimezoneState>()(
    persist(
        (set) => ({
            timezone: '',

            setTimezone: (tz) => {
                // 验证时区是否合法
                if (tz !== '') {
                    try {
                        Intl.DateTimeFormat(undefined, { timeZone: tz })
                    } catch {
                        return
                    }
                }
                set({ timezone: tz })
            },
        }),
        { name: STORAGE_KEY }
    )
)

/** 获取当前有效时区（供非组件代码调用） */
export function getEffectiveTimezone(): string | undefined {
    const tz = useTimezoneStore.getState().timezone
    return tz || undefined
}
