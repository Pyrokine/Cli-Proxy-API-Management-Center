import type {Language} from '@/types'
import {LANGUAGE_ORDER, STORAGE_KEY_LANGUAGE} from '@/utils/constants'

export const isSupportedLanguage = (value: string): value is Language => LANGUAGE_ORDER.includes(value as Language)

const parseStoredLanguage = (value: string): Language | null => {
    try {
        const parsed    = JSON.parse(value)
        const candidate = parsed?.state?.language ?? parsed?.language ?? parsed
        if (typeof candidate === 'string' && isSupportedLanguage(candidate)) {
            return candidate
        }
    } catch {
        if (isSupportedLanguage(value)) {
            return value
        }
    }
    return null
}

const getStoredLanguage = (): Language | null => {
    if (typeof window === 'undefined') {
        return null
    }
    try {
        const stored = localStorage.getItem(STORAGE_KEY_LANGUAGE)
        if (!stored) {
            return null
        }
        return parseStoredLanguage(stored)
    } catch {
        return null
    }
}

const getBrowserLanguage = (): Language => {
    if (typeof navigator === 'undefined') {
        return 'zh-CN'
    }
    const raw   = navigator.languages?.[0] || navigator.language || 'zh-CN'
    const lower = raw.toLowerCase()
    if (lower.startsWith('zh')) {
        return 'zh-CN'
    }
    if (lower.startsWith('ru')) {
        return 'ru'
    }
    return 'en'
}

export const getInitialLanguage = (): Language => getStoredLanguage() ?? getBrowserLanguage()
