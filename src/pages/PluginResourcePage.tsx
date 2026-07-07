import {EmptyState} from '@/components/ui/EmptyState'
import {pluginsApi} from '@/services/api/plugins'
import {useAuthStore} from '@/stores'
import {normalizeApiBase} from '@/utils/connection'
import {getErrorMessage} from '@/utils/helpers'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useParams} from 'react-router-dom'
import styles from './PluginResourcePage.module.scss'
import {
    collectPluginResourceEntries,
    PLUGIN_RESOURCES_REFRESH_EVENT,
    pluginResourceKey,
    resolvePluginAssetURL,
} from './pluginResources'

const pluginResourcePathPrefix = '/v0/resource/plugins/'

const trustedPluginResourceURL = (src: string, apiBase: string): URL | null => {
    const base        = normalizeApiBase(apiBase) || window.location.origin
    const baseURL     = new URL(base)
    const resourceURL = new URL(src, baseURL)
    if (resourceURL.origin !== baseURL.origin) {
        return null
    }
    if (!resourceURL.pathname.startsWith(pluginResourcePathPrefix)) {
        return null
    }
    return resourceURL
}

export function PluginResourcePage() {
    const { t }                     = useTranslation()
    const params                    = useParams<{ pluginId: string; resourceKey: string }>()
    const apiBase                   = useAuthStore((state) => state.apiBase)
    const managementKey             = useAuthStore((state) => state.managementKey)
    const pluginID                  = useMemo(() => params.pluginId ?? '', [params.pluginId])
    const resourceKey               = useMemo(() => pluginResourceKey(params.resourceKey ?? ''), [params.resourceKey])
    const [loading, setLoading]     = useState(true)
    const [error, setError]         = useState('')
    const [iframeSrc, setIframeSrc] = useState('')
    const loadSeqRef                = useRef(0)
    const loadAbortRef              = useRef<AbortController | null>(null)

    const loadResource = useCallback(async (options?: { skipLeadingState?: boolean }) => {
        const sequence     = loadSeqRef.current + 1
        loadSeqRef.current = sequence
        loadAbortRef.current?.abort()
        const controller       = new AbortController()
        loadAbortRef.current   = controller
        const isCurrentRequest = () => loadSeqRef.current === sequence && !controller.signal.aborted

        if (!options?.skipLeadingState) {
            setLoading(true)
            setError('')
            setIframeSrc('')
        }
        try {
            const plugins = await pluginsApi.list({ signal: controller.signal })
            if (!isCurrentRequest()) {
                return
            }
            const resource = collectPluginResourceEntries(plugins.plugins)
                .find((entry) => entry.pluginID === pluginID && entry.resourceKey === resourceKey)
            if (!resource) {
                setError(t('plugin_resource.not_found', { defaultValue: 'Plugin page not found' }))
                return
            }
            const src = resolvePluginAssetURL(resource.menu.path, apiBase)
            if (!src) {
                setError(t('plugin_resource.empty_src', { defaultValue: 'Plugin page path is empty' }))
                return
            }
            const resourceURL = trustedPluginResourceURL(src, apiBase)
            if (!resourceURL) {
                setError(t('plugin_resource.invalid_src', { defaultValue: 'Plugin page path is invalid' }))
                return
            }
            const headers  = managementKey ? { Authorization: `Bearer ${managementKey}` } : undefined
            const response = await fetch(
                resourceURL.toString(),
                { credentials: 'include', headers, signal: controller.signal },
            )
            if (!response.ok) {
                setError(`${response.status} ${response.statusText}`.trim())
                return
            }
            if (!isCurrentRequest()) {
                return
            }
            setIframeSrc(resourceURL.toString())
        } catch (err: unknown) {
            if (isCurrentRequest()) {
                setError(getErrorMessage(err) ||
                         t('plugin_resource.load_failed', { defaultValue: 'Failed to load plugin page' }))
            }
        } finally {
            if (isCurrentRequest()) {
                setLoading(false)
                if (loadAbortRef.current === controller) {
                    loadAbortRef.current = null
                }
            }
        }
    }, [apiBase, managementKey, pluginID, resourceKey, t])

    useEffect(() => {
        const id = window.setTimeout(() => {
            void loadResource()
        }, 0)
        return () => window.clearTimeout(id)
    }, [loadResource])

    useEffect(
        () => () => {
            loadSeqRef.current += 1
            loadAbortRef.current?.abort()
        },
        [],
    )

    useEffect(() => {
        const handleRefresh = () => {
            void loadResource()
        }
        window.addEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, handleRefresh)
        return () => window.removeEventListener(PLUGIN_RESOURCES_REFRESH_EVENT, handleRefresh)
    }, [loadResource])

    return (
        <div className={styles.page}>
            {loading ? (
                <div className={styles.stateShell}>
                    <div className={styles.statusPanel}>{t('common.loading')}</div>
                </div>
            ) : error ? (
                <div className={styles.stateShell}>
                    <EmptyState
                        title={t('plugin_resource.unavailable', { defaultValue: 'Plugin page unavailable' })}
                        description={error}
                    />
                </div>
            ) : (
                    <iframe
                        className={styles.frame}
                        src={iframeSrc}
                        title={t('plugin_resource.title', { defaultValue: 'Plugin page' })}
                        referrerPolicy='no-referrer'
                        sandbox='allow-scripts allow-forms allow-popups allow-downloads'
                        allow='clipboard-read; clipboard-write'
                    />
                )}
        </div>
    )
}
