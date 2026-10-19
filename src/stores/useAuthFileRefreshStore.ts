import {create} from 'zustand'

export type AuthFileRefreshRequest = {
    generation: number
    target: {name: string; auth_index: string} | {all: true}
}

export const useAuthFileRefreshStore = create<{request: AuthFileRefreshRequest | null}>(() => ({
    request: null,
}))
