import iconAmp from '@/assets/icons/amp.svg'
import iconClaude from '@/assets/icons/claude.svg'
import iconCodexDark from '@/assets/icons/codex_dark.svg'
import iconCodexLight from '@/assets/icons/codex_light.svg'

import iconGemini from '@/assets/icons/gemini.svg'
import iconIflow from '@/assets/icons/iflow.svg'
import iconKimiDark from '@/assets/icons/kimi-dark.svg'
import iconKimiLight from '@/assets/icons/kimi-light.svg'
import iconOpenaiDark from '@/assets/icons/openai-dark.svg'
import iconOpenaiLight from '@/assets/icons/openai-light.svg'
import iconQwen from '@/assets/icons/qwen.svg'
import iconVertex from '@/assets/icons/vertex.svg'
import type {VendorDefinition} from '@/components/credentials'
import {createVendorRegistry, GlobalSettings, useCredentialsData, VendorSection} from '@/components/credentials'
import {IconSearch} from '@/components/ui/icons'
import {Input} from '@/components/ui/Input'
import {useAutoRefresh} from '@/hooks/useAutoRefresh'
import {useConfigStore, useThemeStore} from '@/stores'
import {getEffectiveTimezone} from '@/stores/useTimezoneStore'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {useTranslation} from 'react-i18next'

import styles from './CredentialsPage.module.scss'

const DEFAULT_AUTO_REFRESH_MS = 60_000

/** Create a React component that renders a vendor icon as <img> */
function makeIconComponent(src: string, alt: string) {
    return function VendorIcon({ size = 20 }: { size?: number }) {
        return <img src={src} alt={alt} width={size} height={size} />
    }
}

/** Create a theme-aware icon component with light/dark variants */
function makeThemedIconComponent(lightSrc: string, darkSrc: string, alt: string) {
    return function ThemedVendorIcon({ size = 20 }: { size?: number }) {
        const resolvedTheme = useThemeStore((s) => s.resolvedTheme)
        const src           = resolvedTheme === 'dark' ? darkSrc : lightSrc
        return <img src={src} alt={alt} width={size} height={size} />
    }
}

/** Format a Date to HH:MM:SS */
function formatTime(date: Date): string {
    const timeZone = getEffectiveTimezone()
    return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        ...(timeZone ? { timeZone } : {}),
    })
}

export default function CredentialsPage() {
    const { t }                         = useTranslation()
    const config                        = useConfigStore((s) => s.config)
    const [searchQuery, setSearchQuery] = useState('')

    const autoRefreshMs = useMemo(() => {
        const seconds = config?.autoRefreshInterval
        if (seconds === undefined || seconds === null) {
            return DEFAULT_AUTO_REFRESH_MS
        }
        if (seconds <= 0) {
            return 0
        }
        return seconds * 1000
    }, [config?.autoRefreshInterval])

    const vendors: VendorDefinition[] = useMemo(
        () =>
            createVendorRegistry({
                                     Gemini: makeIconComponent(iconGemini, 'Gemini'),
                                     Claude: makeIconComponent(iconClaude, 'Claude'),
                                     Codex: makeThemedIconComponent(iconCodexLight, iconCodexDark, 'Codex'),
                                     Vertex: makeIconComponent(iconVertex, 'Vertex'),
                                     OpenAI: makeThemedIconComponent(iconOpenaiLight, iconOpenaiDark, 'OpenAI'),
                                     Ampcode: makeIconComponent(iconAmp, 'Ampcode'),
                                     Kimi: makeThemedIconComponent(iconKimiLight, iconKimiDark, 'Kimi'),
                                     Qwen: makeIconComponent(iconQwen, 'Qwen'),
                                     IFlow: makeIconComponent(iconIflow, 'iFlow'),
                                 }),
        [],
    )

    const { vendorData, loading, error, refresh }          = useCredentialsData(vendors)
    const { lastRefreshedAt, isRefreshing, markRefreshed } = useAutoRefresh(refresh, autoRefreshMs)

    // Mark initial load as refreshed
    useEffect(() => {
        if (!loading && !lastRefreshedAt) {
            markRefreshed()
        }
    }, [loading, lastRefreshedAt, markRefreshed])

    const handleRefresh = useCallback(async () => {
        await refresh()
        markRefreshed()
    }, [refresh, markRefreshed])

    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <h1 className={styles.title}>{t('credentials.page_title')}</h1>
                <div className={styles.headerRight}>
                    {lastRefreshedAt && (
                        <span className={styles.lastUpdated}>
              {t('credentials.last_updated')} {formatTime(lastRefreshedAt)}
            </span>
                    )}
                    {(loading || isRefreshing) && <span className='loading-spinner' aria-hidden='true' />}
                </div>
            </div>

            <div className={styles.searchBar}>
                <IconSearch size={14} />
                <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('auth_files.search_placeholder')}
                    className={styles.searchInput}
                />
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <div className={styles.vendorList}>
                {vendors.map((vendor) => (
                    <VendorSection
                        key={vendor.id}
                        vendor={vendor}
                        data={vendorData.get(vendor.id) ?? { apiKeys: [], authFiles: [], stats: { requests: 0 } }}
                        disableControls={loading}
                        onRefresh={handleRefresh}
                        searchQuery={searchQuery}
                    />
                ))}
            </div>

            <GlobalSettings config={config} disableControls={loading} />
        </div>
    )
}
