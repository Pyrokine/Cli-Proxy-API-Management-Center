export type DevinCallbackError = 'invalid' | 'state_mismatch'

export function validateDevinCallback(input: string, expectedState?: string): DevinCallbackError | undefined {
    let url: URL
    try {
        url = new URL(input.trim())
    } catch {
        return 'invalid'
    }

    const params = url.searchParams
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        params.getAll('state').length !== 1 ||
        !params.get('state')?.trim() ||
        !['code', 'error', 'error_description'].some((key) => params.get(key)?.trim())
    ) {
        return 'invalid'
    }
    return expectedState && params.get('state') === expectedState ? undefined : 'state_mismatch'
}
