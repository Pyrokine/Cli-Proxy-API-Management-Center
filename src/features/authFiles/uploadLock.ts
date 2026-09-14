let activeUpload: Promise<unknown> | null = null
const listeners                           = new Set<() => void>()

type AuthFileUploadLockResult<T> =
    | { started: true; value: T }
    | { started: false }

const notifyUploadLockChanged = (): void => {
    listeners.forEach((listener) => listener())
}

export async function withAuthFileUploadLock<T>(
    operation: () => Promise<T>,
): Promise<AuthFileUploadLockResult<T>> {
    if (activeUpload) {
        return { started: false }
    }

    const upload = Promise.resolve().then(operation)
    activeUpload = upload
    notifyUploadLockChanged()
    try {
        return { started: true, value: await upload }
    } finally {
        if (activeUpload === upload) {
            activeUpload = null
            notifyUploadLockChanged()
        }
    }
}

export const isAuthFileUploadInFlight = (): boolean => activeUpload !== null

export const subscribeAuthFileUploadLock = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
