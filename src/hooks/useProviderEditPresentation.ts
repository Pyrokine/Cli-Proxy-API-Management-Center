import type {Location} from 'react-router-dom'
import {useLocation} from 'react-router-dom'

type ProviderEditModalState = {
    fromAiProviders: true
    presentation: 'modal'
    presentationToken: string
    backgroundLocation: Location
    returnFocusId?: string
    childReturnFocusId?: string
}

const activePresentationTokens = new Set<string>()
let fallbackTokenSequence      = 0

const PROVIDER_EDIT_PATH = new RegExp(
    '^/credentials/(?:gemini|interactions|codex|claude|xai|vertex|openai)/' +
    '(?:new|\\d+)(?:/models)?/?$',
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)

const createPresentationToken = (): string => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID()
    }
    fallbackTokenSequence += 1
    return `provider-edit-${fallbackTokenSequence}`
}

export function createProviderEditModalState(
    backgroundLocation: Location,
    returnFocusId?: string,
): ProviderEditModalState {
    const presentationToken = createPresentationToken()
    activePresentationTokens.add(presentationToken)
    return {
        fromAiProviders: true,
        presentation: 'modal',
        presentationToken,
        backgroundLocation,
        ...(returnFocusId ? { returnFocusId } : {}),
    }
}

export function resolveProviderEditModalState(
    state: unknown,
    pathname?: string,
): ProviderEditModalState | null {
    if (!isRecord(state) || state.presentation !== 'modal' || state.fromAiProviders !== true) {
        return null
    }
    const presentationToken = typeof state.presentationToken === 'string' ? state.presentationToken : ''
    if (!presentationToken || !activePresentationTokens.has(presentationToken)) {
        return null
    }
    if (pathname && !PROVIDER_EDIT_PATH.test(pathname)) {
        return null
    }
    const backgroundLocation = state.backgroundLocation
    if (!isRecord(backgroundLocation) || backgroundLocation.pathname !== '/credentials') {
        return null
    }
    const returnFocusId      = typeof state.returnFocusId === 'string' ? state.returnFocusId : undefined
    const childReturnFocusId = typeof state.childReturnFocusId === 'string'
                               ? state.childReturnFocusId
                               : undefined
    return {
        fromAiProviders: true,
        presentation: 'modal',
        presentationToken,
        backgroundLocation: backgroundLocation as unknown as Location,
        ...(returnFocusId ? { returnFocusId } : {}),
        ...(childReturnFocusId ? { childReturnFocusId } : {}),
    }
}

export function withProviderEditReturnFocus(state: unknown, returnFocusId: string): unknown {
    const presentation = resolveProviderEditModalState(state)
    if (!presentation) {
        return state
    }
    return { ...presentation, childReturnFocusId: returnFocusId }
}

export function providerEditTriggerId(vendorId: string, identity: string): string {
    return `provider-edit-${encodeURIComponent(vendorId)}-${encodeURIComponent(identity)}`
}

export function useProviderEditPresentation(): ProviderEditModalState | null {
    const location = useLocation()
    return resolveProviderEditModalState(location.state, location.pathname)
}
