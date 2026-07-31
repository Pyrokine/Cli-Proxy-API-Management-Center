import {useAuthStore} from '@/stores'
import {compareLooseSemver, parseLooseSemver} from '@/utils/looseSemver'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import styles from './VersionCompatBanner.module.scss'

/**
 * Two-way version compatibility check:
 *   - The panel knows the minimum server build it requires (__COMPAT_MIN_SERVER__
 *     baked at build time).
 *   - The server knows the minimum panel version it requires (min_panel_version
 *     returned from GET /v0/management/version).
 * Either direction failing is enough to warn; augmented builds are ordered
 * after the base semantic version so "v1.7.16-aug.1" requires matching
 * augmented endpoints instead of being treated as plain "v1.7.16".
 */

interface Mismatch {
    reason: 'server_too_old' | 'panel_too_old'
    panelVersion: string
    serverVersion: string
    minServerVersion: string
    minPanelVersion: string
}

function detectMismatch(panelVersion: string, serverVersion: string, minPanelVersion: string): Mismatch | null {
    const compatMinServer = typeof __COMPAT_MIN_SERVER__ === 'string' ? __COMPAT_MIN_SERVER__ : ''
    const panel           = parseLooseSemver(panelVersion)
    const server          = parseLooseSemver(serverVersion)
    const minServer       = parseLooseSemver(compatMinServer)
    const minPanel        = parseLooseSemver(minPanelVersion)

    // Missing data on either side: treat as compatible rather than risking a
    // false-positive banner during rollouts.
    if (server && minServer && compareLooseSemver(server, minServer) < 0) {
        return {
            reason: 'server_too_old',
            panelVersion: panelVersion.trim().replace(/^[vV]+/, ''),
            serverVersion: serverVersion.trim().replace(/^[vV]+/, ''),
            minServerVersion: compatMinServer.trim().replace(/^[vV]+/, ''),
            minPanelVersion: minPanelVersion.trim().replace(/^[vV]+/, ''),
        }
    }
    if (panel && minPanel && compareLooseSemver(panel, minPanel) < 0) {
        return {
            reason: 'panel_too_old',
            panelVersion: panelVersion.trim().replace(/^[vV]+/, ''),
            serverVersion: serverVersion.trim().replace(/^[vV]+/, ''),
            minServerVersion: compatMinServer.trim().replace(/^[vV]+/, ''),
            minPanelVersion: minPanelVersion.trim().replace(/^[vV]+/, ''),
        }
    }
    return null
}

export function VersionCompatBanner() {
    const { t }                     = useTranslation()
    const auth                      = useAuthStore()
    const [dismissed, setDismissed] = useState(false)

    const panelVersion    = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''
    const serverVersion   = auth.serverVersion || ''
    const minPanelVersion = auth.serverMinPanelVersion || ''

    const mismatch = detectMismatch(panelVersion, serverVersion, minPanelVersion)

    if (!mismatch || dismissed) {
        return null
    }

    const message =
              mismatch.reason === 'server_too_old'
              ? t('compat.server_too_old', {
                  defaultValue:
                      'Panel v{{panel}} requires server ≥ {{min}}, but server is v{{server}}. Upgrade the backend.',
                  panel: mismatch.panelVersion,
                  min: mismatch.minServerVersion,
                  server: mismatch.serverVersion,
              })
              : t('compat.panel_too_old', {
                  defaultValue:
                      'Server v{{server}} requires panel ≥ {{min}}, but panel is v{{panel}}. Upgrade the panel.',
                  panel: mismatch.panelVersion,
                  server: mismatch.serverVersion,
                  min: mismatch.minPanelVersion,
              })

    return (
        <div className={styles.banner} role='alert'>
            <span className={styles.message}>{message}</span>
            <button
                type='button'
                className={styles.dismiss}
                onClick={() => setDismissed(true)}
                aria-label={t('common.close', { defaultValue: 'Close' })}
            >
                ×
            </button>
        </div>
    )
}
