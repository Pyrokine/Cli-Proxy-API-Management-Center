const normalizeQuotaCredentialProvider = (type: string | undefined): string => {
    const normalized = (type || '').trim().toLowerCase()
    if (normalized === 'x-ai' || normalized === 'grok') {
        return 'xai'
    }
    if (normalized === 'anthropic') {
        return 'claude'
    }
    if (normalized === 'cognition') {
        return 'devin'
    }
    return normalized
}

export const quotaCredentialKey = (
    type: string | undefined,
    fileName: string,
    authIndex?: string | number | null,
): string => {
    const provider = normalizeQuotaCredentialProvider(type)
    const baseKey  = `${provider}::${fileName.trim()}`
    const identity = String(authIndex ?? '').trim()
    return provider === 'devin' && identity ? `${baseKey}::${identity}` : baseKey
}
