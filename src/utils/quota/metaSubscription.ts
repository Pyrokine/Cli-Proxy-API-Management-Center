export interface MetaSubscriptionSnapshot {
    planName: string | null
    isSubscriptionActive: boolean | null
}

export function parseMetaSubscriptionSnapshot(value: unknown): MetaSubscriptionSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null
    }
    const data = value as Record<string, unknown>
    if (data.available !== false || data.reason !== 'usage_not_provided' ||
        !Array.isArray(data.windows) || data.windows.length !== 0) {
        return null
    }
    return {
        planName: typeof data.planName === 'string' && data.planName.trim() ? data.planName.trim() : null,
        isSubscriptionActive: typeof data.isSubscriptionActive === 'boolean' ? data.isSubscriptionActive : null,
    }
}
