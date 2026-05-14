/**
 * Resolver functions for extracting data from auth files.
 */

import type { AuthFileItem } from '@/types'
import { normalizePlanType } from './parsers'

export function resolveCodexPlanType(file: AuthFileItem): string | null {
    const metadata =
        file && typeof file.metadata === 'object' && file.metadata !== null
            ? (file.metadata as Record<string, unknown>)
            : null
    const attributes =
        file && typeof file.attributes === 'object' && file.attributes !== null
            ? (file.attributes as Record<string, unknown>)
            : null
    const idToken =
        file && typeof file.id_token === 'object' && file.id_token !== null
            ? (file.id_token as Record<string, unknown>)
            : null
    const metadataIdToken =
        metadata && typeof metadata.id_token === 'object' && metadata.id_token !== null
            ? (metadata.id_token as Record<string, unknown>)
            : null
    const candidates = [
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
