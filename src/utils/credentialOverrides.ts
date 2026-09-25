export const getCredentialRetryValidationKey = (value: number | undefined) =>
    value !== undefined && !Number.isSafeInteger(value) ? 'auth_files.request_retry_invalid' : undefined
