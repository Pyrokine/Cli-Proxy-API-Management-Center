export const normalizeBooleanValue = (value: unknown): boolean | undefined => {
    if (typeof value === 'boolean') {
        return value
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value !== 0
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase()
        if (normalized === 'true' || normalized === '1') {
            return true
        }
        if (normalized === 'false' || normalized === '0') {
            return false
        }
    }
    return undefined
}
