/**
 * Persistent notification source catalogue.
 *
 * This file is the single source of truth for WHICH events push a persistent notification
 * (surfaced in the notification center bell panel) versus transient toasts only.
 *
 * Rule: any call to `addPersistentNotification(msg, type, source)` MUST use a source id
 * from `PERSISTENT_NOTIFICATION_SOURCES`. New kinds of event → extend this catalogue so
 * operators have a written definition of what the panel is supposed to surface.
 */

export type NotificationSourceId =
    'version'
    | 'model-update'
    | 'quota'
    | 'import'
    | 'connection'
    | 'release'
    | 'security'

export interface NotificationSourceDef {
    /** Stable id passed to addPersistentNotification(source) */
    id: NotificationSourceId
    /** What triggers it (documentation for the code reader) */
    trigger: string
    /** Typical severity */
    defaultType: 'info' | 'success' | 'warning' | 'error'
    /** Translation key for panel grouping / display */
    labelKey: string
}

export const PERSISTENT_NOTIFICATION_SOURCES: Record<NotificationSourceId, NotificationSourceDef> = {
    version: {
        id: 'version',
        trigger: 'New backend or panel version detected during version check',
        defaultType: 'warning',
        labelKey: 'notifications.sources.version',
    },
    'model-update': {
        id: 'model-update',
        trigger: 'Manual or automatic model catalog refresh result',
        defaultType: 'info',
        labelKey: 'notifications.sources.model_update',
    },
    quota: {
        id: 'quota',
        trigger: 'Quota polling or manual quota refresh result',
        defaultType: 'warning',
        labelKey: 'notifications.sources.quota',
    },
    import: {
        id: 'import',
        trigger: 'Usage import succeeded and changed persisted data',
        defaultType: 'info',
        labelKey: 'notifications.sources.import',
    },
    connection: {
        id: 'connection',
        trigger: 'Panel connection to CPA changed between connected and error',
        defaultType: 'error',
        labelKey: 'notifications.sources.connection',
    },
    release: {
        id: 'release',
        trigger: 'Release switch, upgrade or deploy action result',
        defaultType: 'info',
        labelKey: 'notifications.sources.release',
    },
    security: {
        id: 'security',
        trigger: 'Management authentication failures, bans or other security events',
        defaultType: 'warning',
        labelKey: 'notifications.sources.security',
    },
}
