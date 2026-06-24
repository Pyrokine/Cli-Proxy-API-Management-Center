import {useNotificationStore} from '@/stores'
import {buildHeaderObject} from '@/utils/headers'
import type {ModelInfo} from '@/utils/models'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

// ---- Types ----

interface HeaderEntry {
    key: string
    value: string
}

interface ModelDiscoveryConfig {
    /** Build the endpoint URL from the baseUrl */
    buildEndpoint: (baseUrl: string) => string

    /** Fetch models from the endpoint */
    fetchModels: (
        baseUrl: string,
        apiKey: string | undefined,
        headers: Record<string, string>,
        proxyUrl?: string,
    ) => Promise<ModelInfo[]>

    /**
     * Determine if auto-fetch should proceed based on credentials.
     * Receives the apiKey field value and the resolved header object.
     */
    canAutoFetch: (apiKey: string, headers: Record<string, string>) => boolean

    /** Build the error message for display */
    buildErrorMessage: (
        err: unknown,
        context: {
            apiKey: string
            headers: Record<string, string>
        },
    ) => string

    /** Normalize a model name (e.g. strip Gemini resource prefix) */
    normalizeName?: (name: string) => string

    /** Translation key prefix (e.g. 'codex', 'gemini') */
    i18nPrefix: string
}

export interface ModelDiscoveryReturn {
    // State
    open: boolean
    setOpen: (open: boolean) => void
    endpoint: string
    discoveredModels: ModelInfo[]
    filteredModels: ModelInfo[]
    fetching: boolean
    error: string
    search: string
    setSearch: (search: string) => void
    selected: Set<string>

    // Actions
    fetchDiscovery: () => Promise<void>
    toggleSelection: (name: string) => void
    applySelected: () => void

    // Derived
    canOpen: boolean
    canApply: boolean
}

interface DiscoveryFormState {
    apiKey: string
    baseUrl?: string
    proxyUrl?: string
    headers: HeaderEntry[]
    modelEntries: Array<{ name: string; alias: string }>
}

/**
 * Encapsulates the model discovery modal state and logic.
 * Used by Codex, Gemini (and potentially other providers with /models discovery).
 */
export function useModelDiscovery<TForm extends DiscoveryFormState>(
    formState: TForm,
    setForm: (updater: (prev: TForm) => TForm) => void,
    flags: {
        disableControls: boolean
        saving: boolean
        loading: boolean
        invalidIndexParam: boolean
        invalidIndex: boolean
    },
    discoveryConfig: ModelDiscoveryConfig,
): ModelDiscoveryReturn {
    const { t }                = useTranslation()
    const { showNotification } = useNotificationStore()

    const [open, setOpen]                         = useState(false)
    const [endpoint, setEndpoint]                 = useState('')
    const [discoveredModels, setDiscoveredModels] = useState<ModelInfo[]>([])
    const [fetching, setFetching]                 = useState(false)
    const [error, setError]                       = useState('')
    const [search, setSearch]                     = useState('')
    const [selected, setSelected]                 = useState<Set<string>>(new Set())
    const autoFetchSignatureRef                   = useRef<string>('')
    const requestIdRef                            = useRef(0)

    const normalizeName = useMemo(
        () => discoveryConfig.normalizeName ?? ((n: string) => String(n ?? '').trim()),
        [discoveryConfig.normalizeName],
    )

    // ---- Filtered models ----

    const filteredModels = useMemo(() => {
        const filter = search.trim().toLowerCase()
        if (!filter) {
            return discoveredModels
        }
        return discoveredModels.filter((model) => {
            const name        = (model.name || '').toLowerCase()
            const alias       = (model.alias || '').toLowerCase()
            const description = (model.description || '').toLowerCase()
            return name.includes(filter) || alias.includes(filter) || description.includes(filter)
        })
    }, [discoveredModels, search])

    // ---- Merge discovered models into form ----

    const mergeDiscoveredModels = useCallback(
        (selectedModels: ModelInfo[]) => {
            if (!selectedModels.length) {
                return
            }

            let addedCount = 0
            setForm((prev) => {
                const mergedMap = new Map<string, { name: string; alias: string }>()
                prev.modelEntries.forEach((entry) => {
                    const name = normalizeName(entry.name)
                    if (!name) {
                        return
                    }
                    const key = name.toLowerCase()
                    mergedMap.set(key, { name, alias: entry.alias?.trim() || '' })
                })

                selectedModels.forEach((model) => {
                    const name = normalizeName(model.name)
                    if (!name) {
                        return
                    }
                    const key = name.toLowerCase()
                    if (mergedMap.has(key)) {
                        return
                    }
                    mergedMap.set(key, { name, alias: model.alias ?? '' })
                    addedCount += 1
                })

                const mergedEntries = Array.from(mergedMap.values())
                return {
                    ...prev,
                    modelEntries: mergedEntries.length ? mergedEntries : [{ name: '', alias: '' }],
                }
            })

            if (addedCount > 0) {
                showNotification(
                    t(`ai_providers.${discoveryConfig.i18nPrefix}_models_fetch_added`, { count: addedCount }),
                    'success',
                )
            }
        },
        [discoveryConfig.i18nPrefix, normalizeName, setForm, showNotification, t],
    )

    // ---- Fetch models ----

    const fetchDiscovery = useCallback(async () => {
        const requestId = (requestIdRef.current += 1)
        setFetching(true)
        setError('')

        try {
            const headerObject = buildHeaderObject(formState.headers)
            const apiKey       = formState.apiKey.trim() || undefined
            const proxyUrl     = formState.proxyUrl?.trim() || undefined
            const list         = await discoveryConfig.fetchModels(
                formState.baseUrl ?? '',
                apiKey,
                headerObject,
                proxyUrl,
            )
            if (requestIdRef.current !== requestId) {
                return
            }
            setDiscoveredModels(list)
        } catch (err: unknown) {
            if (requestIdRef.current !== requestId) {
                return
            }
            setDiscoveredModels([])
            const headerObject = buildHeaderObject(formState.headers)
            setError(
                discoveryConfig.buildErrorMessage(err, {
                    apiKey: formState.apiKey.trim(),
                    headers: headerObject,
                }),
            )
        } finally {
            if (requestIdRef.current === requestId) {
                setFetching(false)
            }
        }
    }, [discoveryConfig, formState.apiKey, formState.baseUrl, formState.headers, formState.proxyUrl])

    // ---- Auto-fetch when modal opens ----

    useEffect(
        () => {
            queueMicrotask(() => {
                if (!open) {
                    autoFetchSignatureRef.current = ''
                    requestIdRef.current += 1
                    setFetching(false)
                    return
                }

                const nextEndpoint = discoveryConfig.buildEndpoint(formState.baseUrl ?? '')
                setEndpoint(nextEndpoint)
                setDiscoveredModels([])
                setSearch('')
                setSelected(new Set())
                setError('')

                if (!nextEndpoint) {
                    return
                }

                const headerObject = buildHeaderObject(formState.headers)
                if (!discoveryConfig.canAutoFetch(formState.apiKey.trim(), headerObject)) {
                    return
                }

                const headerSignature = Object.entries(headerObject)
                                              .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
                                              .map(([key, value]) => `${key}:${value}`)
                                              .join('|')
                const signature       = `${nextEndpoint}||${formState.apiKey.trim()}||${formState.proxyUrl?.trim() ??
                                                                                        ''}||${headerSignature}`
                if (autoFetchSignatureRef.current === signature) {
                    return
                }
                autoFetchSignatureRef.current = signature

                void fetchDiscovery()
            })
        },
        [
            discoveryConfig,
            fetchDiscovery,
            formState.apiKey,
            formState.baseUrl,
            formState.headers,
            formState.proxyUrl,
            open,
        ],
    )

    // ---- Toggle selection ----

    const toggleSelection = (name: string) => {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(name)) {
                next.delete(name)
            } else {
                next.add(name)
            }
            return next
        })
    }

    // ---- Apply selected ----

    const applySelected = () => {
        const selectedModels = discoveredModels.filter((model) => selected.has(model.name))
        if (selectedModels.length) {
            mergeDiscoveredModels(selectedModels)
        }
        setOpen(false)
    }

    // ---- Derived flags ----

    const canOpen =
              !flags.disableControls &&
              !flags.saving &&
              !flags.loading &&
              !flags.invalidIndexParam &&
              !flags.invalidIndex

    const canApply = !flags.disableControls && !flags.saving && !fetching

    return {
        open,
        setOpen,
        endpoint,
        discoveredModels,
        filteredModels,
        fetching,
        error,
        search,
        setSearch,
        selected,
        fetchDiscovery,
        toggleSelection,
        applySelected,
        canOpen,
        canApply,
    }
}
