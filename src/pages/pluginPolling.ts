import {apiClient} from '@/services/api/client'
import {
    type PluginEntry,
    pluginsApi,
    pluginStoreApi,
    type PluginStoreEntry,
    type PluginStoreResponse,
} from '@/services/api/plugins'

const PLUGIN_STATE_TIMEOUT_MS  = 15000
const PLUGIN_STATE_INTERVAL_MS = 500

const abortError = () => new DOMException('The operation was aborted', 'AbortError')

const throwIfAborted = (signal?: AbortSignal) => {
    if (signal?.aborted) {
        throw abortError()
    }
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    throwIfAborted(signal)
    const timeoutId = window.setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
    }, ms)
    const onAbort   = () => {
        window.clearTimeout(timeoutId)
        reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
})

interface PluginStoreStateWaitResult {
    response: PluginStoreResponse
    plugin: PluginStoreEntry | null
    timedOut: boolean
}

export async function waitForPluginStoreState(
    id: string,
    sourceId: string,
    predicate: (plugin: PluginStoreEntry, response: PluginStoreResponse) => boolean,
    timeoutMs      = PLUGIN_STATE_TIMEOUT_MS,
    intervalMs     = PLUGIN_STATE_INTERVAL_MS,
    signal?: AbortSignal,
    authGeneration = apiClient.getAuthGeneration(),
): Promise<PluginStoreStateWaitResult> {
    const deadline        = Date.now() + timeoutMs
    const throwIfInactive = () => {
        throwIfAborted(signal)
        if (authGeneration !== apiClient.getAuthGeneration()) {
            throw abortError()
        }
    }
    throwIfInactive()
    let latest = await pluginStoreApi.list({ signal, timeout: Math.max(1, deadline - Date.now()) })

    for (; ;) {
        throwIfInactive()
        const plugin = latest.plugins.find((item) => item.id === id && (!sourceId || item.source_id === sourceId)) ??
                       null
        if (plugin && predicate(plugin, latest)) {
            return { response: latest, plugin, timedOut: false }
        }
        if (Date.now() >= deadline) {
            return { response: latest, plugin, timedOut: true }
        }
        await wait(Math.min(intervalMs, Math.max(0, deadline - Date.now())), signal)
        throwIfInactive()
        latest = await pluginStoreApi.list({ signal, timeout: Math.max(1, deadline - Date.now()) })
    }
}

export async function waitForPluginRuntimeState(
    id: string,
    predicate: (plugin: PluginEntry, response: Awaited<ReturnType<typeof pluginsApi.list>>) => boolean,
    isCurrent: () => boolean,
    timeoutMs  = PLUGIN_STATE_TIMEOUT_MS,
    intervalMs = PLUGIN_STATE_INTERVAL_MS,
): Promise<{ response: Awaited<ReturnType<typeof pluginsApi.list>>; plugin: PluginEntry | null; timedOut: boolean }> {
    const deadline = Date.now() + timeoutMs
    for (; ;) {
        if (!isCurrent()) {
            throw abortError()
        }
        const response = await pluginsApi.list({ timeout: Math.max(1, deadline - Date.now()) })
        if (!isCurrent()) {
            throw abortError()
        }
        const plugin = response.plugins.find((item) => item.id === id) ?? null
        if (plugin && predicate(plugin, response)) {
            return { response, plugin, timedOut: false }
        }
        if (Date.now() >= deadline) {
            return { response, plugin, timedOut: true }
        }
        await wait(Math.min(intervalMs, Math.max(0, deadline - Date.now())))
    }
}
