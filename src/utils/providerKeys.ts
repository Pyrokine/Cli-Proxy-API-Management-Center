const OAUTH_PROVIDER_ALIASES = new Map([
                                           ['anti-gravity', 'antigravity'],
                                           ['grok', 'xai'],
                                           ['muse', 'meta'],
                                           ['x-ai', 'xai'],
                                           ['x.ai', 'xai'],
                                       ])

export const normalizeOAuthProviderKey = (value: string): string => {
    const key = value.trim().toLowerCase().replace(/_/g, '-')
    return OAUTH_PROVIDER_ALIASES.get(key) ?? key
}
