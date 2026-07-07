export const normalizeQuotaCredentialProvider = (type: string | undefined): string => {
    const normalized = (type || '').trim().toLowerCase()
    if (normalized === 'x-ai' || normalized === 'grok') {
        return 'xai'
    }
    if (normalized === 'anthropic') {
        return 'claude'
    }
    return normalized
}

export const quotaCredentialKey = (type: string | undefined, fileName: string): string =>
    `${normalizeQuotaCredentialProvider(type)}::${fileName.trim()}`
