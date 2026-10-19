import {create} from 'zustand'

type AuthFileStatusRequest = {
    generation: number
    name: string
    authIndex: string
}

export const authFileStatusRequestKey = (generation: number, name: string, authIndex?: string | number | null): string =>
    JSON.stringify([generation, name, String(authIndex ?? '').trim()])

export const useAuthFileStatusStore = create<{requests: ReadonlyMap<string, AuthFileStatusRequest>}>(() => ({
    requests: new Map(),
}))
