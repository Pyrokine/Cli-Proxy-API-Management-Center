/**
 * Resolver functions for extracting data from auth files.
 */

import type {AuthFileItem} from '@/types'
import {normalizePlanType} from './parsers'

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null
    }
    return value as Record<string, unknown>
}

function normalizeStringValue(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim()
        return trimmed ? trimmed : null
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toString()
    }
    return null
}

function normalizeNumberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value
    }
    if (typeof value === 'string') {
        const parsed = Number(value.trim())
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

function decodeBase64Url(value: string): string | null {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded     = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
    try {
        return decodeURIComponent(
            Array.from(globalThis.atob(padded))
                 .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
                 .join(''),
        )
    } catch {
        return null
    }
}

function parseIdTokenPayload(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'string') {
        return toRecord(value)
    }
    const parts = value.split('.')
    if (parts.length < 2) {
        return null
    }
    const decoded = decodeBase64Url(parts[1])
    if (!decoded) {
        return null
    }
    try {
        return toRecord(JSON.parse(decoded))
    } catch {
        return null
    }
}

function resolveCodexAuthInfo(value: unknown): Record<string, unknown> | null {
    const payload = parseIdTokenPayload(value)
    if (!payload) {
        return null
    }
    const nested = toRecord(payload['https://api.openai.com/auth'])
    return nested ?? payload
}

function normalizeDateLikeValue(value: unknown): string | number | null {
    const numberValue = normalizeNumberValue(value)
    if (numberValue === 0) {
        return null
    }
    if (numberValue !== null) {
        return numberValue
    }

    const stringValue = normalizeStringValue(value)
    if (!stringValue || stringValue === '0') {
        return null
    }
    return stringValue
}

export function resolveCodexPlanType(file: AuthFileItem): string | null {
    const metadata        = toRecord(file.metadata)
    const attributes      = toRecord(file.attributes)
    const idToken         = toRecord(file.id_token)
    const metadataIdToken = toRecord(metadata?.id_token)
    const candidates      = [
        file.plan_type,
        file.planType,
        file['plan_type'],
        file['planType'],
        file.id_token,
        idToken?.plan_type,
        idToken?.planType,
        metadata?.plan_type,
        metadata?.planType,
        metadata?.id_token,
        metadataIdToken?.plan_type,
        metadataIdToken?.planType,
        attributes?.plan_type,
        attributes?.planType,
        attributes?.id_token,
    ]

    for (const candidate of candidates) {
        const planType = normalizePlanType(candidate)
        if (planType) {
            return planType
        }
    }

    return null
}

export function resolveCodexSubscriptionActiveUntil(file: AuthFileItem): string | number | null {
    const metadata               = toRecord(file.metadata)
    const attributes             = toRecord(file.attributes)
    const idToken                = resolveCodexAuthInfo(file.id_token)
    const metadataIdToken        = resolveCodexAuthInfo(metadata?.id_token)
    const attributesIdToken      = resolveCodexAuthInfo(attributes?.id_token)
    const subscription           = toRecord(file.subscription)
    const metadataSubscription   = toRecord(metadata?.subscription)
    const attributesSubscription = toRecord(attributes?.subscription)
    const candidates             = [
        file.chatgpt_subscription_active_until,
        file.chatgptSubscriptionActiveUntil,
        file.subscription_active_until,
        file.subscriptionActiveUntil,
        subscription?.active_until,
        subscription?.activeUntil,
        idToken?.chatgpt_subscription_active_until,
        idToken?.chatgptSubscriptionActiveUntil,
        metadata?.chatgpt_subscription_active_until,
        metadata?.chatgptSubscriptionActiveUntil,
        metadata?.subscription_active_until,
        metadata?.subscriptionActiveUntil,
        metadataSubscription?.active_until,
        metadataSubscription?.activeUntil,
        metadataIdToken?.chatgpt_subscription_active_until,
        metadataIdToken?.chatgptSubscriptionActiveUntil,
        attributes?.chatgpt_subscription_active_until,
        attributes?.chatgptSubscriptionActiveUntil,
        attributes?.subscription_active_until,
        attributes?.subscriptionActiveUntil,
        attributesSubscription?.active_until,
        attributesSubscription?.activeUntil,
        attributesIdToken?.chatgpt_subscription_active_until,
        attributesIdToken?.chatgptSubscriptionActiveUntil,
    ]

    for (const candidate of candidates) {
        const value = normalizeDateLikeValue(candidate)
        if (value !== null) {
            return value
        }
    }

    return null
}
