import {DEFAULT_API_PORT, MANAGEMENT_API_PREFIX} from './constants'
import {isEncodedStorageValue} from './encryption'

function containsEncodedStorageValue(input: string): boolean {
    return isEncodedStorageValue(input) ||
           input.includes('enc::v2::') ||
           input.includes('enc::v1::') ||
           input.includes('plain::')
}

export const normalizeApiBase = (input: string | null | undefined): string => {
    let base = (input || '').trim()
    if (!base || containsEncodedStorageValue(base)) {
        return ''
    }
    base = base.replace(/\/?v0\/management\/?$/i, '')
    base = base.replace(/\/+$/i, '')
    if (!/^https?:\/\//i.test(base)) {
        // noinspection HttpUrlsUsage
        base = `http://${base}`
    }
    return base
}

export const resolveApiBase = (...inputs: Array<string | null | undefined>): string => {
    for (const input of inputs) {
        const normalized = normalizeApiBase(input)
        if (normalized) {
            return normalized
        }
    }
    return ''
}

export const computeApiUrl = (base: string): string => {
    const normalized = normalizeApiBase(base)
    if (!normalized) {
        return ''
    }
    return `${normalized}${MANAGEMENT_API_PREFIX}`
}

export const detectApiBaseFromLocation = (): string => {
    try {
        const { protocol, hostname, port } = window.location
        const normalizedPort               = port ? `:${port}` : ''
        return normalizeApiBase(`${protocol}//${hostname}${normalizedPort}`)
    } catch (error) {
        console.warn('Failed to detect api base from location, fallback to default', error)
        return normalizeApiBase(`http://localhost:${DEFAULT_API_PORT}`)
    }
}
